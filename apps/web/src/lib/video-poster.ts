/**
 * 動画ファイルの最初のフレームからポスター画像を作るユーティリティ (ブラウザ専用)。
 *
 * ## なぜポスターが必要か
 *
 * `<video>` に poster を付けないと、再生前は真っ黒 (または透明) の矩形として
 * 記事に並ぶ。記事一覧やスクロール中の見え方が著しく悪くなるうえ、
 * 「読み込みに失敗しているのか、まだ再生していないだけなのか」が
 * 読者に区別できない。
 *
 * ## なぜサーバ側 (ffmpeg) でやらないか
 *
 * EC2 に ffmpeg を追加インストールする必要があり、
 * デプロイスクリプト (user-data.sh) の変更とインスタンスの再作成を伴う。
 * 最初のフレームを 1 枚取るだけなら、ブラウザの <video> + canvas で十分できる。
 * 失敗してもポスター無しで動作するので、可用性上の risk も小さい。
 *
 * ## 注意
 *
 * この関数は DOM API (document / HTMLVideoElement / canvas) に依存するため、
 * サーバ側では呼べない。呼び出しは 'use client' のコンポーネントからのみ。
 */

/** ポスター生成の最大待ち時間 (ms)。これを超えたら諦めて null を返す。 */
const POSTER_TIMEOUT_MS = 8000;

/** ポスター画像の長辺上限 (px)。記事幅を考えるとこれで十分で、容量も小さい。 */
const POSTER_MAX_EDGE = 1280;

/** JPEG 品質。0.8 は目視で劣化が分からず、かつ十分小さい。 */
const POSTER_QUALITY = 0.8;

/**
 * 長辺が上限を超える場合に縮小した寸法を返す。
 * 縦横比は維持する。
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = POSTER_MAX_EDGE,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    // メタデータが読めなかった場合の保険。呼び出し側で捨てられる。
    return { width: 0, height: 0 };
  }
  const longest = Math.max(width, height);
  if (longest <= maxEdge) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export type VideoProbeResult = {
  /** 尺 (秒)。測定できなければ null。 */
  durationSeconds: number | null;
  /** 最初のフレームの JPEG。生成できなければ null。 */
  poster: Blob | null;
};

/**
 * 動画ファイルから尺とポスター画像を取り出す。
 *
 * 失敗しても例外を投げず、取れたものだけを返す。
 * ポスターや尺が取れないことを理由に投稿そのものを失敗させたくないため。
 */
export async function probeVideoFile(file: File): Promise<VideoProbeResult> {
  // SSR / テスト環境では DOM が無いので何もしない。
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') {
    return { durationSeconds: null, poster: null };
  }

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  // 音声を鳴らさずに seek させるため。ミュートしないと
  // 一部ブラウザで自動再生ポリシーに引っかかる。
  video.muted = true;
  // iOS Safari で全画面に遷移させない。
  video.playsInline = true;
  video.src = objectUrl;

  const cleanup = () => {
    video.removeAttribute('src');
    // load() を呼ばないとバックグラウンドで取得が続くことがある。
    try {
      video.load();
    } catch {
      /* noop */
    }
    URL.revokeObjectURL(objectUrl);
  };

  try {
    const result = await withTimeout(captureFirstFrame(video), POSTER_TIMEOUT_MS);
    return result ?? { durationSeconds: null, poster: null };
  } catch {
    // 壊れた動画・未対応コーデックなど。ポスター無しで進める。
    return { durationSeconds: null, poster: null };
  } finally {
    cleanup();
  }
}

/** 指定時間で null に倒れる Promise ラッパ。 */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * メタデータ読み込み → 先頭付近へ seek → canvas に描画、の一連。
 *
 * 0 秒ちょうどではなく少し進めた位置を使うのは、
 * 動画の 1 フレーム目が真っ黒(フェードイン)であることが多く、
 * それをポスターにすると結局黒い矩形になってしまうため。
 */
function captureFirstFrame(video: HTMLVideoElement): Promise<VideoProbeResult> {
  return new Promise((resolve, reject) => {
    const onError = () => reject(new Error('video load error'));

    video.addEventListener('error', onError, { once: true });

    video.addEventListener(
      'loadedmetadata',
      () => {
        const rawDuration = video.duration;
        const durationSeconds =
          Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null;

        // 尺の 10% か 0.1 秒の小さいほう。極端に短いクリップで
        // 末尾を超えて seek しないように上限も掛ける。
        const target =
          durationSeconds === null
            ? 0
            : Math.min(0.1, Math.max(0, durationSeconds * 0.1));

        const draw = () => {
          try {
            const { width, height } = fitWithin(video.videoWidth, video.videoHeight);
            if (width <= 0 || height <= 0) {
              resolve({ durationSeconds, poster: null });
              return;
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              resolve({ durationSeconds, poster: null });
              return;
            }
            ctx.drawImage(video, 0, 0, width, height);
            canvas.toBlob(
              (blob) => resolve({ durationSeconds, poster: blob }),
              'image/jpeg',
              POSTER_QUALITY,
            );
          } catch {
            // canvas が汚染されている等。ポスター無しで続行。
            resolve({ durationSeconds, poster: null });
          }
        };

        // seek できない (尺不明) 場合はその場で描く。
        if (target <= 0) {
          // メタデータ直後だと最初のフレームがまだ無いことがあるので
          // loadeddata を待つ。
          if (video.readyState >= 2) {
            draw();
          } else {
            video.addEventListener('loadeddata', draw, { once: true });
          }
          return;
        }

        video.addEventListener('seeked', draw, { once: true });
        try {
          video.currentTime = target;
        } catch {
          draw();
        }
      },
      { once: true },
    );
  });
}
