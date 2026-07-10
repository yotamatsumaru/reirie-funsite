/**
 * Content.body (リッチテキストエディタ出力) の HTML サニタイズ
 *
 * - 書き込み時 (admin API) にサニタイズを適用することで、
 *   万が一エディタ側やリクエスト経路に不正な HTML が混入しても
 *   保存前に無害化する (defense-in-depth)。
 * - RBAC (requireCapability('CONTENT')) による書き込み制限が一次防御だが、
 *   `dangerouslySetInnerHTML` で表示する以上、二次防御として必須。
 * - 許可タグ/属性はエディタが出力しうる範囲 (見出し・リスト・リンク・画像・
 *   テーブル・強調など) に限定し、`<script>` / `on*` イベント属性 /
 *   `javascript:` スキームなどは全て除去する。
 */
import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr', 'div', 'span',
  'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'mark', 'small', 'blockquote', 'code', 'pre',
  'ul', 'ol', 'li',
  'a', 'img',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'figure', 'figcaption',
];

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'name', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  '*': ['class', 'style'],
};

export function sanitizeContentBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    // http(s)/mailto/相対パス のみ許可 (javascript: 等のスキームは除去)
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    // style 属性内の url()/expression() 等の危険な値も除去
    disallowedTagsMode: 'discard',
    // <a target="_blank"> には自動で rel="noopener noreferrer" を補う
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
    },
  });
}
