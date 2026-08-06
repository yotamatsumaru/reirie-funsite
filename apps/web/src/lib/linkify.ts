/**
 * プレーンテキスト中の URL / メールアドレスを検出してリンク化するための
 * トークナイザ。
 *
 * 背景:
 *   お知らせ (Announcement.body) はリッチテキストではなく
 *   「改行込みのプレーンテキスト」として保存・表示している
 *   (詳細ページは whitespace-pre-wrap で描画)。
 *   そのため本文に URL を書いてもただの文字列で、クリックできなかった。
 *
 * 設計方針:
 *   - **HTML は一切生成しない**。React 要素に変換するための
 *     トークン配列を返すだけにして、`dangerouslySetInnerHTML` を避ける。
 *     こうすることで XSS の余地が原理的に無くなる
 *     (エスケープ漏れという概念が発生しない)。
 *   - 許可スキームは http / https / mailto のみ。
 *     `javascript:` や `data:` は**リンクにせず素のテキストとして残す**。
 *   - `www.` 始まりは https:// を補完する (運用上よく書かれるため)。
 *   - 自サイトのリンクは内部リンク (Next.js の <Link>) として扱えるよう
 *     `isInternal` を付けて返す。
 */

/** リンク化結果のトークン */
export type LinkifyToken =
  | { type: 'text'; value: string }
  | {
      type: 'link';
      /** 画面に表示する文字列 (入力されたそのまま) */
      value: string;
      /** href 属性に入れる正規化済み URL */
      href: string;
      /** mailto: リンクかどうか */
      isEmail: boolean;
    };

/**
 * URL の本体として認める文字 (RFC 3986 の unreserved + reserved + `%`)。
 *
 * ⚠️ ここを `[^\s<>"'`]+` のような「否定クラス」にしてはいけない。
 *    日本語は URL の区切り文字として空白を使わないことが多いため、
 *
 *      応募は https://example.com/formから！
 *      詳細は https://example.com/aをご覧ください
 *
 *    のようなテキストで「から！」「をご覧ください」まで URL に
 *    飲み込まれ、リンク先が壊れてしまう
 *    (実際にこのバグを踏んだのでホワイトリスト方式に変更した)。
 *
 * 日本語を含む URL は、ブラウザからコピーすれば
 * パーセントエンコード済み (%E6%97%A5...) になるので実用上問題ない。
 */
const URL_BODY_CHAR = "[A-Za-z0-9\\-._~:/?#\\[\\]@!$&'()*+,;=%]";

/**
 * URL / メールアドレスを検出する正規表現。
 *
 *  1. scheme 付き URL   : https://example.com/path?a=1#x
 *  2. www. 始まり       : www.example.com
 *  3. メールアドレス     : foo@example.com
 *
 * 末尾の句読点 (。、）) や閉じ括弧は URL に含めないよう後処理で削る。
 */
const LINK_RE = new RegExp(
  [
    // 1) scheme 付き (http/https/mailto)
    `(?:https?:\\/\\/|mailto:)${URL_BODY_CHAR}+`,
    // 2) www. 始まり (scheme 省略)
    `www\\.${URL_BODY_CHAR}+`,
    // 3) メールアドレス
    '[\\w.!#$%&\'*+/=?^`{|}~-]+@[\\w-]+(?:\\.[\\w-]+)+',
  ].join('|'),
  'gi',
);

/**
 * URL の末尾に紛れ込みがちな文字を取り除く。
 *
 *   「詳細は https://example.com/foo。」→ 末尾の「。」は URL ではない
 *   「(https://example.com/foo)」        → 閉じ括弧は URL ではない
 *
 * ただし括弧が URL 内で対応が取れている場合 (Wikipedia 等) は残す。
 */
function trimTrailingPunctuation(raw: string): string {
  let url = raw;

  // 明確に URL の一部になり得ない文字を末尾から削る
  const TRAILING = '.,;:!?"\'’”。、，．！？」』）)]}>';
  while (url.length > 0 && TRAILING.includes(url[url.length - 1]!)) {
    const last = url[url.length - 1]!;

    // 閉じ括弧は、対応する開き括弧が URL 内にあるなら残す
    if (last === ')' || last === '）') {
      const open = last === ')' ? '(' : '（';
      const opens = url.split(open).length - 1;
      const closes = url.split(last).length - 1;
      if (opens >= closes) break;
    }
    if (last === ']' && url.split('[').length - 1 >= url.split(']').length - 1) break;
    if (last === '}' && url.split('{').length - 1 >= url.split('}').length - 1) break;

    url = url.slice(0, -1);
  }

  return url;
}

/** href に使える安全なスキームか (javascript: 等を弾く) */
function isSafeHref(href: string): boolean {
  // 先頭の制御文字・空白を除去したうえで判定する
  // (「java\nscript:」のような回避を防ぐ)
  const normalized = href.replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
  return (
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('mailto:')
  );
}

/**
 * プレーンテキストを「テキスト」と「リンク」のトークン列に分解する。
 *
 * @example
 *   linkify('詳細は https://example.com/a をご覧ください')
 *   // → [
 *   //     { type: 'text', value: '詳細は ' },
 *   //     { type: 'link', value: 'https://example.com/a', href: '…', isEmail: false },
 *   //     { type: 'text', value: ' をご覧ください' },
 *   //   ]
 */
export function linkify(text: string): LinkifyToken[] {
  if (!text) return [];

  const tokens: LinkifyToken[] = [];
  let lastIndex = 0;

  // 正規表現の状態を持ち回さないよう毎回作り直す (g フラグの lastIndex 対策)
  const re = new RegExp(LINK_RE.source, LINK_RE.flags);

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const rawMatch = m[0];
    const matchStart = m.index;

    // 末尾の句読点を URL から除外する
    const cleaned = trimTrailingPunctuation(rawMatch);
    if (cleaned.length === 0) {
      // 全部句読点だった (通常あり得ない) → テキスト扱い
      continue;
    }

    // href の正規化
    const isEmail = !/^(?:https?:\/\/|mailto:)/i.test(cleaned) && cleaned.includes('@');
    let href: string;
    if (isEmail) {
      href = `mailto:${cleaned}`;
    } else if (/^www\./i.test(cleaned)) {
      href = `https://${cleaned}`;
    } else {
      href = cleaned;
    }

    // 危険なスキームはリンクにしない (テキストとして残す)
    if (!isSafeHref(href)) {
      continue;
    }

    // マッチ前のテキスト
    if (matchStart > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, matchStart) });
    }

    tokens.push({ type: 'link', value: cleaned, href, isEmail });

    // 削った句読点はテキストとして戻す
    lastIndex = matchStart + cleaned.length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return tokens;
}

/**
 * `href` が自サイト内のリンクかどうかを判定する。
 * 内部リンクなら Next.js の <Link> でクライアント遷移させられる。
 *
 * @param href   判定対象 (絶対 URL)
 * @param origin 自サイトの origin (例: 'https://reirie.com')。未指定なら常に false。
 */
export function isInternalHref(href: string, origin?: string): boolean {
  if (!origin) return false;
  try {
    const target = new URL(href);
    const self = new URL(origin);
    return target.origin === self.origin;
  } catch {
    return false;
  }
}

/**
 * メール本文 (HTML) 用に URL をアンカータグへ変換する。
 * React を使えないメールテンプレート専用。
 *
 * ⚠️ 引数は **HTML エスケープ済みの文字列** を渡すこと。
 *    この関数はエスケープを行わない (二重エスケープを避けるため)。
 *    エスケープ後の文字列に対して動くよう、`&amp;` を含む URL も
 *    正しく扱える設計にしている。
 */
export function linkifyEscapedHtml(escapedText: string): string {
  const re = new RegExp(LINK_RE.source, LINK_RE.flags);

  return escapedText.replace(re, (rawMatch) => {
    const cleaned = trimTrailingPunctuation(rawMatch);
    if (!cleaned) return rawMatch;

    const isEmail =
      !/^(?:https?:\/\/|mailto:)/i.test(cleaned) && cleaned.includes('@');
    let href: string;
    if (isEmail) {
      href = `mailto:${cleaned}`;
    } else if (/^www\./i.test(cleaned)) {
      href = `https://${cleaned}`;
    } else {
      href = cleaned;
    }

    if (!isSafeHref(href)) return rawMatch;

    // href 内の " は既にエスケープ済み (&quot;) なので属性値として安全
    const trailing = rawMatch.slice(cleaned.length);
    // mailto: は新規タブではなくメーラーを開くので target は付けない
    const attrs = isEmail ? '' : ' target="_blank" rel="noopener noreferrer"';
    return (
      `<a href="${href}"${attrs}` +
      ` style="color:#7c5295;text-decoration:underline;">${cleaned}</a>${trailing}`
    );
  });
}
