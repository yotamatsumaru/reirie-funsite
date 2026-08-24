/**
 * 動画メタ情報（タイトル / 説明 / 公開範囲 / 配信期限）編集のロジック。
 *
 * ## なぜ純粋関数として切り出すか
 * jest の testMatch は `**\/*.test.ts` のみで `.tsx` を拾わない。
 * 入力の正規化や差分検出はバグが混入しやすい割に UI と絡めるとテストしづらいので、
 * React に依存しない形でここに集約してユニットテストの対象にする。
 *
 * ## 編集可能な項目と、そうでない項目
 * 編集可: title / description / accessLevel / expiresAt
 *   → いずれも「運営が後から言い直せるべき」情報。アップロード時に
 *     ファイル名から仮のタイトルを入れる導線があるため、後から直せないと
 *     ファイル名がそのまま会員に見えてしまう。
 * 編集不可: s3SourceKey / s3HlsKey / status / durationSeconds
 *   → 実体（S3 上のファイルやエンコード結果）と紐づく情報で、
 *     DB だけ書き換えると実体と乖離して再生不能になる。
 * isPublished は専用の visibility API があるのでここでは扱わない
 * （1 つの API に混ぜると「保存」で意図せず公開状態が変わる事故が起きる）。
 */

export const VIDEO_TITLE_MAX = 200;
export const VIDEO_DESCRIPTION_MAX = 2000;

export type VideoEditFormValues = {
  title: string;
  description: string;
  accessLevel: string;
  /** `<input type="datetime-local">` の値。空文字は「期限なし」 */
  expiresAt: string;
};

export type VideoEditPatch = {
  title?: string;
  description?: string | null;
  accessLevel?: string;
  expiresAt?: string | null;
};

/**
 * `Date` を `<input type="datetime-local">` に入れられる
 * `YYYY-MM-DDTHH:mm` 形式（日本時間）へ変換する。
 *
 * datetime-local は「タイムゾーンを持たないローカル時刻」を扱うため、
 * UTC の値をそのまま流すと本番（UTC サーバー）で 9 時間ずれて表示される。
 * 一覧表示側が JST 固定（formatJstDateTime）なので、編集フォームも JST に揃える。
 */
export function toDatetimeLocalJst(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  // JST = UTC+9。ロケール依存を避けるため実数演算でずらしてから ISO を切り出す。
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 16);
}

/**
 * `<input type="datetime-local">` の値（JST として解釈）を ISO 文字列へ戻す。
 * 空文字は「期限なし」を意味する null を返す。
 */
export function fromDatetimeLocalJst(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  // 既にオフセットが付いていればそのまま、無ければ +09:00 を付けて
  // JST として確定させる（実行環境の TZ 設定に依存させない）。
  const hasZone = /([+-]\d{2}:\d{2}|Z)$/.test(v);
  const d = new Date(hasZone ? v : `${v}+09:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export type ValidationResult = { ok: true } | { ok: false; message: string };

/** 保存前の入力検証。サーバー側の zod と条件を合わせること。 */
export function validateVideoEdit(values: VideoEditFormValues): ValidationResult {
  const title = values.title.trim();
  if (!title) return { ok: false, message: 'タイトルを入力してください' };
  if (title.length > VIDEO_TITLE_MAX) {
    return { ok: false, message: `タイトルは${VIDEO_TITLE_MAX}文字以内で入力してください` };
  }
  if (values.description.length > VIDEO_DESCRIPTION_MAX) {
    return {
      ok: false,
      message: `説明文は${VIDEO_DESCRIPTION_MAX}文字以内で入力してください`,
    };
  }
  if (values.expiresAt.trim() && fromDatetimeLocalJst(values.expiresAt) === null) {
    return { ok: false, message: '配信期限の日時が不正です' };
  }
  return { ok: true };
}

/**
 * 変更があった項目だけを含む差分を作る。
 *
 * 全項目を毎回送らない理由: 監査ログに「実際に何を直したか」を残したいのと、
 * 同時編集時に触っていない項目を上書きして戻してしまう事故を避けるため。
 */
export function buildVideoEditPatch(
  initial: VideoEditFormValues,
  current: VideoEditFormValues,
): VideoEditPatch {
  const patch: VideoEditPatch = {};

  const nextTitle = current.title.trim();
  if (nextTitle !== initial.title.trim()) patch.title = nextTitle;

  // 説明文は前後の空白のみ落とす。空にしたら「説明なし」= null。
  const nextDesc = current.description.trim();
  if (nextDesc !== initial.description.trim()) {
    patch.description = nextDesc === '' ? null : nextDesc;
  }

  if (current.accessLevel !== initial.accessLevel) patch.accessLevel = current.accessLevel;

  // 日時は文字列比較だと表記揺れを拾うので ISO 化して比較する。
  const nextExp = fromDatetimeLocalJst(current.expiresAt);
  const prevExp = fromDatetimeLocalJst(initial.expiresAt);
  if (nextExp !== prevExp) patch.expiresAt = nextExp;

  return patch;
}

/** 差分が空か（= 保存ボタンを押させる必要がないか） */
export function isEmptyPatch(patch: VideoEditPatch): boolean {
  return Object.keys(patch).length === 0;
}
