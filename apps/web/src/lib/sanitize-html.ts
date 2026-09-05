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
  // 本文に貼る短い動画クリップ。source は付けず video[src] 単独で使う
  // (エディタが 1 ファイル 1 URL でしか挿入しないため、source を許すと
  //  複数ソースの整合性を検証する必要が出て許可面が無駄に広がる)。
  'video',
];

/**
 * video に許可する属性。
 *
 * 危険なもの・意図しない挙動を招くものは意図的に外している:
 *   - `autoplay` … 記事を開いた瞬間に音が鳴る事故を防ぐ。
 *     エディタも autoplay を出力しない。muted 付き autoplay を許すと
 *     「muted を後から外す」改変で騒音になりうるため、まとめて不許可。
 *   - `crossorigin` … 外部オリジンの資格情報付き取得を招く可能性がある。
 *   - `on*` … sanitize-html が既定で落とすが、許可リストにも入れない。
 *
 * `controls` は許可する。これが落ちると再生も停止もできない矩形になる。
 * `preload` はエディタが metadata を付与する (一覧で全部読み込ませないため)。
 * `playsinline` は iOS Safari で全画面に勝手に遷移させないために必須。
 */
const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'name', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  video: [
    'src',
    'controls',
    'poster',
    'preload',
    'playsinline',
    'muted',
    'loop',
    'width',
    'height',
    'title',
  ],
  '*': ['class', 'style'],
};

export function sanitizeContentBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    // http(s)/mailto/相対パス のみ許可 (javascript: 等のスキームは除去)
    allowedSchemes: ['http', 'https', 'mailto'],
    // 既定では href / src / cite だけがスキーム検査の対象。
    // video の poster も URL を取るので明示的に検査対象へ加える。
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite', 'poster'],
    allowProtocolRelative: false,
    // style 属性内の url()/expression() 等の危険な値も除去
    disallowedTagsMode: 'discard',
    // <a target="_blank"> には自動で rel="noopener noreferrer" を補う
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
    },
  });
}
