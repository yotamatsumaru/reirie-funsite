/**
 * 記事 slug (公開 URL の一部) の生成と検証。
 *
 * 従来の slugify は `[^a-z0-9\s-]` を全部落としていたため、
 * 「新曲リリースのお知らせ」のような日本語タイトルでは slug が空文字になり、
 * 保存ボタンを押すと「slug は英小文字・数字・ハイフンのみ」と怒られる、
 * という詰みが起きていた (タイトルを入れただけでは保存できない)。
 *
 * ここでは:
 *   - ラテン文字を含むタイトルはこれまで通り単語をハイフンで繋ぐ
 *   - 日本語だけのタイトルは空になるので、日付ベースの候補にフォールバックする
 * ことで「何も考えずに保存できる」状態にする。
 * 日本語をローマ字変換しないのは、辞書なしでは読みを誤り
 * (例: 「一日」→ ichinichi / tsuitachi)、URL が意味不明になるため。
 */

/** slug として許可する形: 英小文字・数字・ハイフン。 */
export const SLUG_PATTERN = /^[a-z0-9-]+$/;

export const MAX_SLUG_LENGTH = 120;

/**
 * タイトルから slug 候補を作る (ラテン文字部分のみ)。
 * 日本語のみのタイトルでは空文字を返す。
 */
export function slugifyTitle(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-$/, '');
}

/**
 * 日付ベースの slug 候補 (`post-20260828-a1b2`)。
 * 末尾のランダム 4 文字は、同じ日に複数記事を作ったときの衝突回避用。
 *
 * @param now       基準時刻 (テスト用に注入可能)
 * @param randomHex 4 桁の 16 進 (テスト用に注入可能)
 */
export function fallbackSlug(now: Date = new Date(), randomHex?: string): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const suffix =
    randomHex ?? Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `post-${yyyy}${mm}${dd}-${suffix}`;
}

/**
 * タイトルから「必ず有効な」slug を作る。
 * ラテン文字が取れればそれを、取れなければ日付ベースの候補を返す。
 */
export function suggestSlug(
  title: string,
  now: Date = new Date(),
  randomHex?: string,
): string {
  const base = slugifyTitle(title);
  return base !== '' ? base : fallbackSlug(now, randomHex);
}

export type SlugValidation = { ok: true } | { ok: false; message: string };

/** 保存前の slug 検証。エラー文言は画面にそのまま出す。 */
export function validateSlug(slug: string): SlugValidation {
  const value = slug.trim();
  if (value === '') {
    return { ok: false, message: 'slug (URL) を入力してください' };
  }
  if (value.length > MAX_SLUG_LENGTH) {
    return {
      ok: false,
      message: `slug は ${MAX_SLUG_LENGTH} 文字以内で入力してください (現在 ${value.length} 文字)`,
    };
  }
  if (!SLUG_PATTERN.test(value)) {
    return {
      ok: false,
      message:
        'slug は英小文字・数字・ハイフンのみで入力してください。日本語タイトルの場合は「自動生成」ボタンをお使いください。',
    };
  }
  return { ok: true };
}
