/**
 * call-devices — 1on1 コールで使うカメラ / マイク / スピーカー選択のロジック
 *
 * ブラウザ API (navigator.mediaDevices) には依存しない純関数のみを置く。
 * DOM を触る処理は components/call/CallRoom.tsx 側に置き、ここはテスト可能に保つ。
 *
 * 背景:
 *   - enumerateDevices() は「カメラ・マイクの許可を得る前」だと
 *     label が空文字 / deviceId が空文字で返ってくる (仕様)。
 *     → 許可前は「カメラ 1」のような代替ラベルを出す必要がある。
 *   - Chrome は 'default' / 'communications' という仮想デバイスも返すため、
 *     同じ groupId の重複を整理する。
 *   - 選択内容は localStorage に保存し、次回入室時に復元する。
 */

export type CallDeviceKind = 'videoinput' | 'audioinput' | 'audiooutput';

/** MediaDeviceInfo のうち、このモジュールが必要とする部分だけ */
export type DeviceInfoLike = {
  deviceId: string;
  kind: string;
  label: string;
  groupId?: string;
};

export type DeviceOption = {
  deviceId: string;
  label: string;
  /** label が空でフォールバック名を使った場合 true (= まだ許可を得ていない可能性) */
  isFallbackLabel: boolean;
};

const FALLBACK_LABEL_PREFIX: Record<CallDeviceKind, string> = {
  videoinput: 'カメラ',
  audioinput: 'マイク',
  audiooutput: 'スピーカー',
};

/** Chrome が返す仮想デバイス。実デバイスと重複するので後ろに回す */
const VIRTUAL_DEVICE_IDS = new Set(['default', 'communications']);

/**
 * enumerateDevices() の結果を <select> 用の選択肢に変換する。
 *
 * - kind でフィルタ
 * - deviceId が空のもの (許可前のプレースホルダ) は除外
 * - deviceId の重複は除外
 * - label が空なら「カメラ 1」等のフォールバック名を付ける
 * - 'default' / 'communications' は実デバイスの後ろに並べる
 */
export function toDeviceOptions(
  devices: readonly DeviceInfoLike[],
  kind: CallDeviceKind,
): DeviceOption[] {
  const matched = devices.filter((d) => d.kind === kind && d.deviceId !== '');

  const seen = new Set<string>();
  const real: DeviceInfoLike[] = [];
  const virtual: DeviceInfoLike[] = [];

  for (const d of matched) {
    if (seen.has(d.deviceId)) continue;
    seen.add(d.deviceId);
    if (VIRTUAL_DEVICE_IDS.has(d.deviceId)) {
      virtual.push(d);
    } else {
      real.push(d);
    }
  }

  const ordered = [...real, ...virtual];

  return ordered.map((d, index) => {
    const label = (d.label ?? '').trim();
    return {
      deviceId: d.deviceId,
      label: label !== '' ? label : `${FALLBACK_LABEL_PREFIX[kind]} ${index + 1}`,
      isFallbackLabel: label === '',
    };
  });
}

/**
 * 保存済み deviceId が今も使えるならそれを、無ければ先頭のデバイスを返す。
 * 選択肢が空なら null (= ブラウザに任せる)。
 */
export function pickDeviceId(
  options: readonly DeviceOption[],
  preferredId?: string | null,
): string | null {
  if (options.length === 0) return null;
  if (preferredId && options.some((o) => o.deviceId === preferredId)) {
    return preferredId;
  }
  return options[0]!.deviceId;
}

/**
 * デバイス名がまだ取得できていない (= 許可待ち) かどうか。
 * true のときは UI に「許可してデバイス名を表示」ボタンを出す。
 */
export function needsPermissionForLabels(options: readonly DeviceOption[]): boolean {
  if (options.length === 0) return true;
  return options.every((o) => o.isFallbackLabel);
}

export type DeviceSelection = {
  videoDeviceId?: string | null;
  audioDeviceId?: string | null;
};

/** 720p を理想値として要求する共通の video 制約 */
const VIDEO_IDEAL = { width: { ideal: 1280 }, height: { ideal: 720 } } as const;

/**
 * getUserMedia に渡す制約を組み立てる。
 *
 * @param selection 選択された deviceId (null / undefined ならブラウザ既定)
 * @param opts.exact true なら deviceId を exact で指定する。
 *                   exact は「その端末が無ければ OverconstrainedError」になるため、
 *                   呼び出し側で失敗したら exact:false で再試行する。
 * @param opts.video false なら映像を要求しない (音声のみ)
 * @param opts.audio false なら音声を要求しない (映像のみ / デバイス切替時)
 */
export function buildMediaConstraints(
  selection: DeviceSelection,
  opts: { exact?: boolean; video?: boolean; audio?: boolean } = {},
): MediaStreamConstraints {
  const { exact = true, video = true, audio = true } = opts;
  const constraints: MediaStreamConstraints = {};

  if (video) {
    const id = selection.videoDeviceId;
    constraints.video = id
      ? { ...VIDEO_IDEAL, deviceId: exact ? { exact: id } : { ideal: id } }
      : { ...VIDEO_IDEAL };
  } else {
    constraints.video = false;
  }

  if (audio) {
    const id = selection.audioDeviceId;
    constraints.audio = id ? { deviceId: exact ? { exact: id } : { ideal: id } } : true;
  } else {
    constraints.audio = false;
  }

  return constraints;
}

// ---------------------------------------------------------------
// localStorage への保存 / 復元
// ---------------------------------------------------------------

export const DEVICE_STORAGE_KEYS: Record<CallDeviceKind, string> = {
  videoinput: 'idol.call.deviceId.video',
  audioinput: 'idol.call.deviceId.audio',
  audiooutput: 'idol.call.deviceId.speaker',
};

/** SSR / localStorage 無効環境でも落ちないように try-catch で包む */
export function readStoredDeviceId(kind: CallDeviceKind): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(DEVICE_STORAGE_KEYS[kind]);
    return v && v !== '' ? v : null;
  } catch {
    return null;
  }
}

export function writeStoredDeviceId(kind: CallDeviceKind, deviceId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (deviceId && deviceId !== '') {
      window.localStorage.setItem(DEVICE_STORAGE_KEYS[kind], deviceId);
    } else {
      window.localStorage.removeItem(DEVICE_STORAGE_KEYS[kind]);
    }
  } catch {
    // ignore (プライベートモード等)
  }
}
