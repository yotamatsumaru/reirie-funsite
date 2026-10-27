/**
 * お知らせに埋め込む「チケットサイトの申込タグ」(Ticket Dive のルート限定タグ等) のサニタイズ。
 *
 * === 何のための機能か ===
 * Ticket Dive の FC 限定販売は「ルート限定タグ」= 主催者画面で発行される HTML タグを
 * ファンクラブサイトに設置し、そのタグ (ボタン / フォーム) から遷移した人だけが
 * 申し込めるようにする仕組み。お知らせ本文はプレーンテキスト (HTML 不可) なので、
 * 本文とは別フィールド (Announcement.embedHtml) に貼れるようにする。
 *
 * === 安全性の方針 (許可リスト方式) ===
 *  - 使えるタグはリンク / フォーム / ボタン / 画像 / iframe / 簡単な装飾だけ。
 *    <script> / <style> / on* イベント属性 / javascript: スキームは全て除去する。
 *  - リンク・フォーム送信先・iframe は **https の許可ドメイン (ticketdive.com) のみ**。
 *    それ以外の宛先はタグごと (iframe / form) または href ごと (a) 落とす。
 *    → 管理者アカウントが乗っ取られても、会員を任意のフィッシングサイトへ送る
 *      フォームを埋め込むことはできない。
 *  - style はレイアウトを壊さない範囲 (色・余白・角丸など) だけ許可し、
 *    position / z-index 等「ページ全体を覆う偽画面」を作れるものは許可しない。
 *  - 書き込み時 (API) と表示時の両方でサニタイズする (多層防御)。
 *
 * === Referer (アクセス元判定) について ===
 * ルート限定は「どのサイトから来たか」(Referer) で判定される。
 * rel="noreferrer" や referrerpolicy="no-referrer" を付けると判定が通らず
 * 会員が申し込めなくなるため、リンクは必ず rel="noopener" (noreferrer なし) +
 * referrerpolicy="strict-origin-when-cross-origin" にそろえる
 * (= Referer として https://reirie.com/ のオリジンだけを送る。lib/linkify.ts と同じ方針)。
 */
import sanitizeHtml from 'sanitize-html';

/** 埋め込みタグの最大文字数 (API の zod と同じ値) */
export const TICKET_EMBED_MAX_LENGTH = 4000;

/**
 * 宛先として許可するドメイン (サブドメインも含む)。
 * 別のチケットサイトにも対応する場合はここに追加し、
 * next.config.ts の CSP (form-action / frame-src) にも同じドメインを足すこと。
 */
export const TICKET_EMBED_ALLOWED_DOMAINS = ['ticketdive.com'] as const;

/** Referer にオリジンだけを送る (アクセス元制限が通り、パスは漏れない) */
const EMBED_REFERRER_POLICY = 'strict-origin-when-cross-origin';

/** iframe に付ける sandbox。申込フォームが動く最小限の権限だけを与える */
const IFRAME_SANDBOX = [
  'allow-scripts',
  'allow-same-origin',
  'allow-forms',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  // 「申し込む」ボタンを押したときだけトップレベル遷移を許す (勝手な遷移は不可)
  'allow-top-navigation-by-user-activation',
].join(' ');

/** URL が https かつ許可ドメイン (またはそのサブドメイン) か */
export function isAllowedTicketUrl(raw: string | undefined | null): boolean {
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false; // 相対 URL や壊れた URL は不可
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false; // https://ticketdive.com@evil.example 等の偽装対策
  const host = url.hostname.toLowerCase();
  return TICKET_EMBED_ALLOWED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

const ALLOWED_TAGS = [
  'a',
  'form',
  'input',
  'button',
  'iframe',
  'img',
  'p',
  'br',
  'div',
  'span',
  'strong',
  'b',
  'em',
  'i',
  'small',
  'label',
];

/** input に許可する type。テキスト入力などで個人情報を集めるフォームは作らせない */
const ALLOWED_INPUT_TYPES = new Set(['hidden', 'submit']);

/**
 * レイアウトを壊さない範囲の style だけ許可する。
 * 値は色・数値・単位・キーワードのみ (括弧を許すと url() / expression() を書けるため、
 * rgb()/rgba() だけを個別に許可する)。
 */
const SAFE_STYLE_VALUE = /^(?:[#a-z0-9 .,%-]+|rgba?\([0-9 .,%]+\))$/i;
const ALLOWED_STYLES: sanitizeHtml.IOptions['allowedStyles'] = {
  '*': Object.fromEntries(
    [
      'color',
      'background-color',
      'background',
      'font-size',
      'font-weight',
      'text-align',
      'text-decoration',
      'line-height',
      'padding',
      'padding-top',
      'padding-bottom',
      'padding-left',
      'padding-right',
      'margin',
      'margin-top',
      'margin-bottom',
      'border',
      'border-radius',
      'border-color',
      'width',
      'max-width',
      'height',
      'display',
    ].map((prop) => [prop, [SAFE_STYLE_VALUE]]),
  ),
};

/** 2 パス目で除去する要素に付ける印 (class)。外部入力と衝突しない固有値 */
const DROP_MARKER = '__ticket_embed_drop__';

export type TicketEmbedResult = {
  /** サニタイズ後の HTML (空文字なら表示しない) */
  html: string;
  /** 取り除いた要素の説明 (管理画面で「このタグは一部使えません」と知らせるため) */
  removed: string[];
};

/**
 * 埋め込みタグをサニタイズする。
 *
 * @returns html と、取り除いたものの一覧 (removed)。
 *          removed が空でない場合、元のタグの一部が動かない可能性がある。
 */
export function sanitizeTicketEmbed(input: string | null | undefined): TicketEmbedResult {
  const removed = new Set<string>();
  const source = (input ?? '').trim();
  if (!source) return { html: '', removed: [] };

  if (/<script[\s>]/i.test(source)) removed.add('<script> (スクリプト) は使えません');
  if (/<style[\s>]/i.test(source)) removed.add('<style> は使えません');
  if (/\son[a-z]+\s*=/i.test(source)) removed.add('onclick などのイベント属性は使えません');

  // 入力に印の文字列そのものが入っていた場合に誤って消えないよう、先に無害化しておく
  const html = sanitizeHtml(source.replaceAll(DROP_MARKER, ''), {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'target', 'rel', 'referrerpolicy', 'title'],
      form: ['action', 'method', 'target', 'accept-charset'],
      input: ['type', 'name', 'value'],
      button: ['type', 'name', 'value'],
      iframe: [
        'src',
        'width',
        'height',
        'title',
        'loading',
        'allow',
        'allowfullscreen',
        'frameborder',
        'sandbox',
        'referrerpolicy',
      ],
      img: ['src', 'alt', 'width', 'height'],
      '*': ['class', 'style'],
    },
    allowedStyles: ALLOWED_STYLES,
    allowedSchemes: ['https'],
    allowedSchemesAppliedToAttributes: ['href', 'src', 'action'],
    allowProtocolRelative: false,
    allowedIframeDomains: [...TICKET_EMBED_ALLOWED_DOMAINS],
    // script / style / textarea の中身は文字としても残さない
    nonTextTags: ['script', 'style', 'textarea', 'noscript'],
    disallowedTagsMode: 'discard',
    // 許可されていないタグを使っていたら、管理画面で知らせるために記録する
    // (script/style は上で専用メッセージを出しているので除く)
    onOpenTag(name: string) {
      const tag = name.toLowerCase();
      if (!ALLOWED_TAGS.includes(tag) && tag !== 'script' && tag !== 'style') {
        removed.add(`<${tag}> は使えません`);
      }
    },
    transformTags: {
      a: (tagName, attribs): sanitizeHtml.Tag => {
        const next: sanitizeHtml.Attributes = { ...attribs };
        if (!isAllowedTicketUrl(next.href)) {
          if (next.href) removed.add(`許可されていないリンク先: ${next.href}`);
          // 行き先の無い「ボタンに見えるリンク」を残さないよう、ただの文字にする
          return { tagName: 'span', attribs: {} };
        }
        // 新しいタブで開く。noreferrer は付けない (ルート限定の判定が通らなくなる)
        next.target = '_blank';
        next.rel = 'noopener';
        next.referrerpolicy = EMBED_REFERRER_POLICY;
        return { tagName, attribs: next };
      },
      form: (tagName, attribs): sanitizeHtml.Tag => {
        const next: sanitizeHtml.Attributes = { ...attribs };
        if (!isAllowedTicketUrl(next.action)) {
          removed.add(`許可されていないフォーム送信先: ${next.action ?? '(未指定)'}`);
          // 送信先が不正なフォームは中身ごと捨てる (2 パス目で除去)
          return { tagName, attribs: { class: DROP_MARKER } };
        }
        const method = (next.method ?? 'get').toLowerCase();
        next.method = method === 'post' ? 'post' : 'get';
        next.target = '_blank';
        return { tagName, attribs: next };
      },
      input: (tagName, attribs): sanitizeHtml.Tag => {
        const type = (attribs.type ?? 'text').toLowerCase();
        if (!ALLOWED_INPUT_TYPES.has(type)) {
          removed.add(`入力欄 (type="${type}") は使えません`);
          return { tagName, attribs: { class: DROP_MARKER } };
        }
        return { tagName, attribs: { ...attribs, type } };
      },
      button: (tagName, attribs): sanitizeHtml.Tag => {
        const type = (attribs.type ?? 'submit').toLowerCase();
        return { tagName, attribs: { ...attribs, type: type === 'button' ? 'button' : 'submit' } };
      },
      iframe: (tagName, attribs): sanitizeHtml.Tag => {
        if (!isAllowedTicketUrl(attribs.src)) {
          removed.add(`許可されていない埋め込み先: ${attribs.src ?? '(未指定)'}`);
          return { tagName, attribs: { class: DROP_MARKER } };
        }
        return {
          tagName,
          attribs: {
            ...attribs,
            // 元タグの sandbox / referrerpolicy は上書きして固定値にする
            sandbox: IFRAME_SANDBOX,
            referrerpolicy: EMBED_REFERRER_POLICY,
            loading: 'lazy',
          },
        };
      },
    },
  });

  // 2 パス目: 1 パス目で「捨てる」印を付けた要素を子要素ごと除去する。
  // (sanitize-html は transformTags の後に属性フィルタを掛けるため、
  //  印は許可済みの class 属性に入れ、ここで exclusiveFilter により判定する)
  const cleaned = sanitizeHtml(html, {
    // 1 パス目と同じ許可リストに限定する (false = 全タグ許可にすると
    // style 等の脆弱タグも通す設定になり、sanitize-html が警告を出す)
    allowedTags: ALLOWED_TAGS,
    // 属性は 1 パス目で許可リスト済み。ここでは落とさない (sandbox / referrerpolicy 等を保持)
    allowedAttributes: false,
    allowedSchemes: ['https'],
    allowedSchemesAppliedToAttributes: ['href', 'src', 'action'],
    allowProtocolRelative: false,
    allowedIframeDomains: [...TICKET_EMBED_ALLOWED_DOMAINS],
    disallowedTagsMode: 'discard',
    exclusiveFilter: (frame) =>
      (frame.attribs?.class ?? '').split(/\s+/).includes(DROP_MARKER),
  }).trim();

  return { html: cleaned, removed: [...removed] };
}
