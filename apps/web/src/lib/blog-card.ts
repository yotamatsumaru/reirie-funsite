/**
 * ブログ一覧カードの表示バリエーション決定 (純粋関数のみ)。
 *
 * ## なぜサムネイル無しで見た目を変えるのか
 *
 * これまではサムネイルが無い記事も、ある記事と同じ 16:9 の枠を確保し、
 * その中に汎用の書類アイコンを 1 つ置いていた。結果として
 *
 *   - カードの上 6 割が「意味のない同じ絵」で埋まる
 *   - サムネイル無しの記事が並ぶと、全部同じ絵のカードが整列して
 *     どれがどの記事か見分けがつかない
 *   - 記事の情報 (タイトル・抜粋) が下の 4 割に押し込められ、
 *     肝心の中身が読めない
 *
 * という状態だった。動画はサムネイルが本質的な情報 (何が映っているか)
 * なので枠を確保する価値があるが、ブログはタイトルと抜粋こそが情報なので
 * 「絵の代わりに文字を見せる」ほうが選びやすい。
 *
 * そこでサムネイル無しの記事は **画像枠を作らず、テキスト主体のカード**
 * にする。タイトルを大きく、抜粋を長め (3 行) に出し、
 * 上部に細いアクセントバーだけ置いて「カードである」ことを示す。
 *
 * ## 動画を変えない理由
 *
 * 動画はサムネイルが無くても「再生時間」「鍵バッジ」を重ねる場所が必要で、
 * かつ一覧での見え方が揃っていないと尺の比較がしづらい。
 * ブログとは要件が違うので、この関数はブログ専用とする。
 *
 * ## 純粋関数として切り出す理由
 *
 * jest の testMatch が `.ts` のみ (.tsx は対象外) のため、
 * 判定ロジックをページコンポーネントに直接書くとテストできない。
 * 「サムネイルの有無で表示が切り替わる」ことは今回の変更の核心なので、
 * 空文字・空白のみといった «あるように見えて無い» ケースを含めて固定する。
 */

/** 一覧カードの表示形態。 */
export type BlogCardVariant =
  /** サムネイル画像を 16:9 で見せる従来のカード */
  | 'cover'
  /** 画像枠を作らず、タイトル・抜粋を主役にするカード */
  | 'text';

/**
 * サムネイル URL として使える文字列かどうか。
 *
 * DB の `coverImageUrl` は nullable だが、実際には
 *   - 管理画面のフォームで空欄のまま保存 → 空文字 ''
 *   - コピペ時に空白が入った → '   '
 * が入ることがある。これらを «画像あり» と判定すると
 * `<img src="">` が出力され、ブラウザが「壊れた画像」アイコンを描く
 * (= 何も無いより見た目が悪い) ため、空白を除いて判定する。
 */
export function hasUsableCoverImage(url: string | null | undefined): boolean {
  if (typeof url !== 'string') return false;
  return url.trim().length > 0;
}

/** サムネイルの有無からカードの表示形態を決める。 */
export function resolveBlogCardVariant(coverImageUrl: string | null | undefined): BlogCardVariant {
  return hasUsableCoverImage(coverImageUrl) ? 'cover' : 'text';
}

/**
 * テキストカードで抜粋を何行まで見せるか。
 *
 * 画像枠が無い分、文字で情報量を稼ぐ。3 行あれば
 * 「その記事が何の話か」は概ね伝わり、かつカードが
 * 縦に伸びすぎない (実際に描画して決めた値)。
 *
 * なおテキストカードは self-start で «内容の高さ» に収めるため、
 * 行数を増やしても他のカードのレイアウトには影響しない。
 * (当初は画像ありカードと高さを揃える意図だったが、
 *  引き伸ばすと巨大な空白ができたので方針を変えた)
 */
export const BLOG_TEXT_CARD_EXCERPT_LINES = 3;

/** 画像ありカードの抜粋行数 (従来と同じ)。 */
export const BLOG_COVER_CARD_EXCERPT_LINES = 2;

/** 表示形態に応じた抜粋の行数を返す。 */
export function excerptLineClamp(variant: BlogCardVariant): number {
  return variant === 'text' ? BLOG_TEXT_CARD_EXCERPT_LINES : BLOG_COVER_CARD_EXCERPT_LINES;
}

/**
 * 抜粋が無い記事のために、本文 HTML から先頭のテキストを作る。
 *
 * ## なぜ必要か
 *
 * テキスト主体のカードにすると、抜粋が空の記事は
 * 「タイトルだけの、ほぼ空白のカード」になってしまう。
 * 画像枠があった頃は絵で埋まっていた面積が、そのまま空白になるため
 * 変更前より寂しく見える。
 *
 * 本文は HTML なのでタグを落としてから使う。
 * `excerpt` が入っている記事では呼ばない (運営が書いた抜粋を優先する)。
 *
 * ## サニタイズ済み HTML を前提にする
 *
 * `Content.body` は保存時に sanitizeContentBody() を通っているため
 * script などは含まれない。ここではタグを機械的に除去してテキストだけ取る。
 * 生成した文字列は React が自動エスケープするので、
 * そのまま `{...}` で描画してよい (dangerouslySetInnerHTML は使わない)。
 */
export function plainTextFromHtml(html: string | null | undefined, maxLength = 120): string | null {
  if (typeof html !== 'string') return null;

  const text = html
    // <br> と閉じブロックタグは空白に落とす。
    // これをやらないと「見出し本文」のように単語が繋がってしまう。
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|figure|tr)>/gi, ' ')
    // 残りのタグを除去
    .replace(/<[^>]*>/g, '')
    // 実体参照のうち、テキストとして出るとおかしいものだけ戻す
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // 連続する空白 (改行含む) を 1 つに畳む
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length === 0) return null;
  if (text.length <= maxLength) return text;

  // 途中で切るので、切れていることが分かるように三点リーダを付ける。
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

/**
 * カードに出す説明文を決める。
 *
 * 優先順位:
 *   1. 運営が書いた抜粋 (excerpt)
 *   2. 本文から自動生成したテキスト
 *   3. null (説明文なし)
 *
 * 2 を使うのはテキストカードのときだけ。画像ありのカードでは
 * 従来どおり抜粋が無ければ何も出さない (見た目を変えないため)。
 */
export function resolveCardDescription(params: {
  variant: BlogCardVariant;
  excerpt: string | null | undefined;
  body?: string | null;
}): string | null {
  const { variant, excerpt, body } = params;

  if (typeof excerpt === 'string' && excerpt.trim().length > 0) {
    return excerpt.trim();
  }
  if (variant === 'text') {
    return plainTextFromHtml(body);
  }
  return null;
}
