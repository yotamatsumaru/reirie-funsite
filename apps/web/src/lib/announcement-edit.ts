/**
 * お知らせ編集フォームのロジック (UI から切り離した純粋関数)
 *
 * ここに切り出している理由:
 *   - 「変更したフィールドだけ送る」という差分計算は、うっかりすると
 *     一斉メールの再送を誘発する危険がある (後述) ため、
 *     React に依存しない形でテストしたい
 *   - 入力チェックを API 側の zod スキーマと同じ条件で二重化し、
 *     サーバーに行く前にユーザーへフィードバックしたい
 */

// 配信対象の定義は announcement-audience.ts が単一の真実の源。
// ここで独自に union を書くと、対象を増やしたときに
// 「フォームには出るのに差分計算で落ちる」といったズレが起きるため再エクスポートする。
export type { AnnouncementAudienceLiteral } from './announcement-audience';
import type { AnnouncementAudienceLiteral } from './announcement-audience';

export type AnnouncementStatusLiteral = 'DRAFT' | 'PUBLISHED';

/** 編集フォームで触れるフィールドだけを抜き出した型。 */
export type AnnouncementEditableFields = {
  title: string;
  body: string;
  audience: AnnouncementAudienceLiteral;
  sendEmail: boolean;
};

/**
 * API (`PATCH /api/super-admin/announcements/[id]`) の zod スキーマと
 * 同じ上限値。片方だけ変えると「クライアントは通るのに 422」になるので
 * 変更するときは両方あわせて直すこと。
 */
export const TITLE_MAX_LENGTH = 200;
export const BODY_MAX_LENGTH = 4000;

/**
 * 送信前の入力チェック。問題がなければ null を返す。
 *
 * API 側の zod は `min(1)` なので、空白だけの入力は trim してから弾く
 * (そうしないと「見た目は空なのに保存できる」ことになる)。
 */
export function validateAnnouncementFields(
  fields: AnnouncementEditableFields,
): string | null {
  const title = fields.title.trim();
  const body = fields.body.trim();

  if (!title) return 'タイトルは必須です';
  if (!body) return '本文は必須です';
  if (title.length > TITLE_MAX_LENGTH) {
    return `タイトルは ${TITLE_MAX_LENGTH} 文字以内で入力してください`;
  }
  if (body.length > BODY_MAX_LENGTH) {
    return `本文は ${BODY_MAX_LENGTH} 文字以内で入力してください`;
  }
  return null;
}

/**
 * 「実際に変わったフィールドだけ」を含む PATCH ボディを作る。
 *
 * ⚠️ 全フィールドを常に送ってはいけない。
 *    API は `sendEmail` を受け取ると
 *    `willNeedEmailQueue` の判定で emailStatus を PENDING に戻し、
 *    公開済みのお知らせに対して一斉メールを再送してしまう
 *    (lib/bulk-email.ts の shouldTriggerEmail 参照)。
 *
 *    つまり「本文の誤字を直しただけ」で会員全員にメールが
 *    二重配信されうる。差分だけ送ることでこれを構造的に防ぐ。
 *
 * また監査ログ (`announcement.update` の metadata.changed) にも
 * この差分がそのまま残るため、後から「何を直したのか」が追える。
 *
 * @returns 変更が無ければ空オブジェクト (呼び出し側でリクエストを省略する)
 */
export function diffAnnouncementFields(
  original: AnnouncementEditableFields,
  next: AnnouncementEditableFields,
): Partial<AnnouncementEditableFields> {
  const patch: Partial<AnnouncementEditableFields> = {};

  // title / body は保存時に trim する仕様なので、比較も trim 済みで行う。
  // (末尾に空白を足しただけを「変更あり」と扱わない)
  const nextTitle = next.title.trim();
  const nextBody = next.body.trim();

  if (nextTitle !== original.title) patch.title = nextTitle;
  if (nextBody !== original.body) patch.body = nextBody;
  if (next.audience !== original.audience) patch.audience = next.audience;
  if (next.sendEmail !== original.sendEmail) patch.sendEmail = next.sendEmail;

  return patch;
}

/** 差分が空か (= 保存ボタンを押しても送る意味がないか)。 */
export function hasNoChanges(patch: Partial<AnnouncementEditableFields>): boolean {
  return Object.keys(patch).length === 0;
}

/**
 * 「このお知らせを編集すると一斉メールが飛ぶ恐れがあるか」。
 *
 * 公開済み × メール送信あり × まだ送信が確定していない状態
 * (NOT_REQUESTED / PENDING / FAILED) の組み合わせだと、
 * PATCH をきっかけに送信処理が走りうる。
 * 該当する場合は編集画面で警告を出して事故を防ぐ。
 */
export function mayTriggerEmailOnEdit(a: {
  status: AnnouncementStatusLiteral;
  sendEmail: boolean;
  emailStatus: 'NOT_REQUESTED' | 'PENDING' | 'SENDING' | 'COMPLETED' | 'FAILED';
}): boolean {
  if (a.status !== 'PUBLISHED' || !a.sendEmail) return false;
  return (
    a.emailStatus === 'NOT_REQUESTED' ||
    a.emailStatus === 'PENDING' ||
    a.emailStatus === 'FAILED'
  );
}
