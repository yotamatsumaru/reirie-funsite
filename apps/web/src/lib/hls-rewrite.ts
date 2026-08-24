/**
 * HLS プレイリスト (m3u8) の URI 書き換えユーティリティ。
 *
 * ## なぜ必要か (`.ts` セグメントが 403 になる問題)
 *
 * CloudFront の署名付き URL は「クエリを含んだその URL 1 本」に対する許可でしかない。
 * HLS 再生では、プレイヤーがマスタープレイリストを読んだあと
 *
 *   index.m3u8 → index_720p.m3u8 → index_720p_00001.ts, ...
 *
 * と **別々のリクエスト** を発行する。プレイリスト内の URI は相対パスなので、
 * プレイヤーはマスターURLのクエリを引き継がずに解決してしまい、
 * 署名なしリクエスト → CloudFront が 403 → 「読み込みは進むが再生できない」
 * という症状になる。
 *
 * 対策は 2 段構え:
 *
 *  1. 署名をワイルドカード (カスタムポリシー `hls/<videoId>/*`) にする
 *     → 同一ディレクトリ配下すべてに 1 つの署名で通せる (cdn-signer.ts)
 *  2. プレイリスト内の URI にその署名クエリを埋め込む (このファイル)
 *     → ネイティブ HLS (iOS Safari) を含むすべてのプレイヤーで再生できる
 *
 * hls.js だけなら `xhrSetup` でクエリを足す手もあるが、iOS Safari は
 * MSE を持たず `<video src>` のネイティブ HLS になるため JS で介入できない。
 * したがって「サーバ側でプレイリストを書き換える」のが唯一の確実な方法。
 */

/** 行末 (CRLF / LF) を保ったまま分解するための分割 */
const LINE_SPLIT = /(\r?\n)/;

/**
 * 署名付き URL からクエリ部分 (先頭の `?` を含まない) を取り出す。
 *
 * canned policy なら `Expires=...&Key-Pair-Id=...&Signature=...`、
 * カスタムポリシーなら `Policy=...&Key-Pair-Id=...&Signature=...` になる。
 * クエリが無ければ空文字を返す。
 */
export function extractSignatureQuery(url: string): string {
  const idx = url.indexOf('?');
  if (idx < 0) return '';
  // ハッシュ以降は署名に含まれないので落とす
  const q = url.slice(idx + 1).split('#')[0] ?? '';
  return q;
}

/**
 * URL にクエリを追加する。
 *
 * - `query` が空なら何もしない
 * - 既に同じキーが付いている場合 (二重署名) は追加しない
 */
export function appendQuery(url: string, query: string): string {
  if (!query) return url;
  const [base, hash] = splitHash(url);
  const existing = extractSignatureQuery(base);
  if (existing) {
    // 既に署名済みらしければ触らない (二重付与を防ぐ)
    const firstKey = query.split('&')[0]?.split('=')[0];
    if (firstKey && new RegExp(`(^|&)${escapeRegExp(firstKey)}=`).test(existing)) {
      return url;
    }
    return `${base}&${query}${hash}`;
  }
  return `${base}?${query}${hash}`;
}

function splitHash(url: string): [string, string] {
  const i = url.indexOf('#');
  return i < 0 ? [url, ''] : [url.slice(0, i), url.slice(i)];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 絶対URL (スキーム付き) かどうか */
function isAbsolute(uri: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(uri) || uri.startsWith('//');
}

/** `./foo.ts` や 余分な空白を落として相対パスを正規化する */
function normalizeRelative(uri: string): string {
  return uri.trim().replace(/^\.\//, '');
}

/** プレイリスト (m3u8) を指す URI かどうか */
export function isPlaylistUri(uri: string): boolean {
  const path = uri.split('?')[0] ?? '';
  return /\.m3u8?$/i.test(path);
}

export type RewriteOptions = {
  /**
   * セグメント等の実体を配信するベースURL (末尾スラッシュ込み)。
   * 例: `https://dxxxx.cloudfront.net/hls/<videoId>/`
   */
  segmentBase: string;
  /** セグメントURLに付与する CloudFront 署名クエリ (先頭 `?` なし) */
  signatureQuery: string;
  /**
   * ネストされたプレイリストを指す URL を生成する関数。
   * 通常は自サーバのプロキシ (さらに書き換えるため) を返す。
   * 省略時はセグメントと同じ扱い (CloudFront 直 + 署名クエリ)。
   */
  playlistUrl?: (relativePath: string) => string;
};

function resolveUri(uri: string, opts: RewriteOptions): string {
  const raw = normalizeRelative(uri);
  if (!raw) return uri;
  // 絶対URL は書き換えない (外部リソースを壊さない)
  if (isAbsolute(raw)) return raw;

  if (isPlaylistUri(raw) && opts.playlistUrl) {
    return opts.playlistUrl(raw);
  }
  return appendQuery(`${opts.segmentBase}${raw}`, opts.signatureQuery);
}

/** タグ内の `URI="..."` 属性 (EXT-X-KEY / EXT-X-MAP / EXT-X-MEDIA 等) を書き換える */
function rewriteTagUris(line: string, opts: RewriteOptions): string {
  return line.replace(/URI="([^"]*)"/g, (_m, uri: string) => {
    if (!uri) return 'URI=""';
    return `URI="${resolveUri(uri, opts)}"`;
  });
}

/**
 * m3u8 本文の相対 URI を、署名クエリ付きの絶対URL (またはプロキシURL) に書き換える。
 *
 * - `#` で始まる行はタグ。`URI="..."` 属性だけを書き換える
 * - それ以外の非空行はリソース URI (セグメント or variant playlist)
 * - 絶対URLはそのまま (外部を壊さない)
 * - 改行コードは元の形を保持する
 */
export function rewritePlaylist(body: string, opts: RewriteOptions): string {
  const parts = body.split(LINE_SPLIT);
  return parts
    .map((part) => {
      // 改行そのものは保持
      if (part === '\n' || part === '\r\n') return part;
      const trimmed = part.trim();
      if (!trimmed) return part;
      if (trimmed.startsWith('#')) return rewriteTagUris(part, opts);
      return resolveUri(part, opts);
    })
    .join('');
}

/** CloudFront 署名らしいクエリかどうか (関係ないクエリを引き継がないため) */
export function looksLikeCloudFrontSignature(query: string): boolean {
  return /(^|&)(Policy|Signature|Key-Pair-Id|Expires)=/.test(query);
}

/**
 * クライアント側 (hls.js xhrSetup) で署名クエリを引き継ぐための判定。
 *
 * `url` が `base` と同一オリジンで、かつクエリを持たない場合にのみ
 * `query` を付与して返す。それ以外は `url` をそのまま返す。
 *
 * 本番の再生経路ではサーバ側プロキシがプレイリストを書き換えるため
 * 通常は no-op だが、CloudFront 署名付き URL を直接渡された場合の保険。
 */
export function inheritQuery(url: string, base: string, query: string): string {
  if (!query) return url;
  try {
    const baseUrl = new URL(base);
    const target = new URL(url, baseUrl);
    if (target.origin !== baseUrl.origin) return url;
    if (target.search) return url;
    target.search = `?${query}`;
    return target.toString();
  } catch {
    return url;
  }
}
