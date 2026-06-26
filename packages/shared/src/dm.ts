/**
 * REIRIE への DM (ダイレクトメッセージ) 機能の純粋ロジック & 定数。
 *
 * ここには副作用のない関数のみを置く (DB アクセスや認証は含めない)。
 * - NG ワード判定 (部分一致): 例「シネマ」は禁止語「シネ」を含むため送信不可。
 * - @ メンション展開: 本文中の "@" を、ファンが登録した「呼んでほしい名前」に置換。
 * - 本文バリデーション。
 *
 * クライアントとサーバーで同じ判定を共有し、表示と実際の送信可否を一致させる
 * (最終的な送信可否の判定はサーバー側 API でも必ず行う)。
 */
import { z } from 'zod';

// ---------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------

/** DM 本文の最大文字数 */
export const DM_MAX_LENGTH = 500;

/** DM 本文の最小文字数 (空白のみは不可) */
export const DM_MIN_LENGTH = 1;

/** 「呼んでほしい名前」の最大文字数 */
export const PREFERRED_NAME_MAX_LENGTH = 20;

/** AppSetting に NG ワード一覧を保存する際のキー */
export const DM_NG_WORDS_SETTING_KEY = 'dm.ngWords';

/**
 * デフォルトの NG ワード一覧。
 * 管理画面で上書きされるまでのフォールバック。
 * (部分一致でブロックされる。例:「シネ」→「シネマ」も不可)
 */
export const DEFAULT_DM_NG_WORDS: string[] = ['死ね', 'シネ', 'ころす', '殺す'];

/** @ メンションのプレースホルダ表記 (本文中ではこの文字列が名前へ展開される) */
export const MENTION_TOKEN = '@';

// ---------------------------------------------------------------------
// NG ワード判定
// ---------------------------------------------------------------------

/** NG ワード一覧を正規化する (前後空白除去・空文字除去・重複除去) */
export function normalizeNgWords(words: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const t = (w ?? '').trim();
    if (t.length === 0) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * 本文に NG ワードが含まれるか判定し、ヒットした語を返す。
 *  - 大文字小文字を区別しない (英語想定)。
 *  - 部分一致 (substring)。例: NG 語「シネ」は本文「シネマ」にヒットする。
 *
 * @returns ヒットした NG ワードの配列 (なければ空配列)
 */
export function findNgWords(body: string, ngWords: readonly string[]): string[] {
  const text = (body ?? '').toLowerCase();
  const hits: string[] = [];
  for (const w of normalizeNgWords(ngWords)) {
    if (text.includes(w.toLowerCase())) {
      hits.push(w);
    }
  }
  return hits;
}

/** 本文に NG ワードが 1 つでも含まれるか */
export function containsNgWord(body: string, ngWords: readonly string[]): boolean {
  return findNgWords(body, ngWords).length > 0;
}

// ---------------------------------------------------------------------
// @ メンション展開
// ---------------------------------------------------------------------

/**
 * 「呼んでほしい名前」を決定する。
 * preferredName → displayName → フォールバック の順で採用する。
 */
export function resolvePreferredName(
  preferredName: string | null | undefined,
  displayName: string | null | undefined,
  fallback = 'あなた',
): string {
  const p = (preferredName ?? '').trim();
  if (p.length > 0) return p;
  const d = (displayName ?? '').trim();
  if (d.length > 0) return d;
  return fallback;
}

/**
 * 本文中の "@" を呼んでほしい名前に展開する。
 *  - 単独の "@" (直後が名前文字でない / 文末) を名前に置換する。
 *  - "@@" のようなエスケープは扱わず、純粋に "@" を name へ置換する単純仕様。
 *  - すでに "@名前" の形で打ってあっても、name へ統一展開する想定だが、
 *    ここでは「裸の @」のみを対象にし、誤爆を避けるため次の文字が
 *    日本語/英数字でない、または文末のケースを名前トークンとみなす。
 *
 * 実装方針 (シンプル & 予測可能):
 *  - "@" の連続しないトークンを name に置換する。
 *  - name 自体に "@" は含まれない前提 (バリデーションで弾く)。
 */
export function expandMentions(body: string, name: string): string {
  if (!body) return body;
  const safeName = (name ?? '').trim() || 'あなた';
  // 裸の "@" を name に置換する。
  // 直後にメンション対象としてユーザーが手入力した名前が続く場合も考慮し、
  // "@" + (任意の非空白の名前候補) があれば、その "@" のみを name に置換する
  // (= 名前候補はそのまま残さず @ を展開) のではなく、ここでは単純に "@" 単体を置換。
  return body.replace(/@/g, safeName);
}

// ---------------------------------------------------------------------
// バリデーション
// ---------------------------------------------------------------------

/** DM 本文のバリデーションスキーマ */
export const DirectMessageBodySchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(
    z
      .string()
      .min(DM_MIN_LENGTH, 'メッセージを入力してください')
      .max(DM_MAX_LENGTH, `メッセージは${DM_MAX_LENGTH}文字以内で入力してください`),
  );

/** DM 送信 API の入力スキーマ */
export const SendDirectMessageSchema = z.object({
  body: DirectMessageBodySchema,
});
export type SendDirectMessageInput = z.infer<typeof SendDirectMessageSchema>;

/** 「呼んでほしい名前」のバリデーションスキーマ (空文字 = 解除) */
export const PreferredNameSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(
    z
      .string()
      .max(PREFERRED_NAME_MAX_LENGTH, `名前は${PREFERRED_NAME_MAX_LENGTH}文字以内で入力してください`)
      .refine((s) => !s.includes('@'), '名前に @ は使用できません'),
  );

/** 「呼んでほしい名前」更新 API の入力スキーマ */
export const UpdatePreferredNameSchema = z.object({
  preferredName: PreferredNameSchema,
});
export type UpdatePreferredNameInput = z.infer<typeof UpdatePreferredNameSchema>;

// ---------------------------------------------------------------------
// 送信前チェック (クライアント/サーバー共通の最終判定)
// ---------------------------------------------------------------------

export type DmCheckResult =
  | { ok: true; body: string }
  | { ok: false; reason: 'EMPTY' | 'TOO_LONG' | 'NG_WORD'; ngWords?: string[] };

/**
 * 送信前の総合チェック。
 *  1. @ メンションを展開
 *  2. trim & 長さチェック
 *  3. NG ワードチェック (展開後の本文に対して)
 *
 * @param rawBody       ユーザー入力の生本文 ("@" を含みうる)
 * @param preferredName 呼んでほしい名前 (@ 展開に使用)
 * @param ngWords       NG ワード一覧
 */
export function checkDirectMessage(
  rawBody: string,
  preferredName: string,
  ngWords: readonly string[],
): DmCheckResult {
  const expanded = expandMentions(rawBody ?? '', preferredName).trim();
  if (expanded.length < DM_MIN_LENGTH) return { ok: false, reason: 'EMPTY' };
  if (expanded.length > DM_MAX_LENGTH) return { ok: false, reason: 'TOO_LONG' };
  const hits = findNgWords(expanded, ngWords);
  if (hits.length > 0) return { ok: false, reason: 'NG_WORD', ngWords: hits };
  return { ok: true, body: expanded };
}
