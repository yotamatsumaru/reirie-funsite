/**
 * HLS セグメントを「自サーバ経由」で中継するためのユーティリティ。
 *
 * ## なぜ自サーバ経由にするのか (CORS を不要にするため)
 *
 * S3 プリサインド URL をプレイリストにそのまま埋め込むと、ブラウザは
 * `https://<bucket>.s3.<region>.amazonaws.com/...` へ **クロスオリジン**で
 * セグメントを取得しようとする。hls.js は XHR/fetch を使うため、この時点で
 * 出力バケット側に CORS 許可 (`GET`/`HEAD` + `Content-Range` の公開) が
 * 無いとブラウザがレスポンスを破棄し、再生が始まらない。
 *
 * CORS を付けるには S3 バケットの設定変更 (= `cdk deploy`) が必要で、
 * 「AWS 側を一切触らずに再生したい」という要件を満たせない。
 *
 * そこでセグメントも `/api/videos/<id>/hls/<file>` から配信する。
 * プレイリストと同一オリジンになるため:
 *
 *   - CORS 設定が **完全に不要**
 *   - バケットは `BlockPublicAccess.BLOCK_ALL` のままでよい
 *   - 署名付き URL がブラウザの履歴/DevTools に露出しない (共有されにくい)
 *   - Cookie セッションでそのまま認可できる (iOS ネイティブ HLS でも同じ)
 *
 * 代償は「動画の帯域が Next.js サーバを通る」こと。CloudFront 署名鍵を
 * 設定できたら自動的に CDN 経路 (`cloudfront` モード) に戻る。
 */

/** 拡張子 → Content-Type。HLS が実際に出力し得るものを網羅する */
const CONTENT_TYPES: Record<string, string> = {
  // MPEG-2 TS セグメント (MediaConvert の既定 HLS 出力)
  ts: 'video/mp2t',
  // fMP4 / CMAF セグメント
  m4s: 'video/iso.segment',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  m4a: 'audio/mp4',
  // 音声のみのレンディション
  aac: 'audio/aac',
  // 字幕
  vtt: 'text/vtt',
  // AES-128 暗号鍵 (#EXT-X-KEY:URI="...")
  key: 'application/octet-stream',
  // I-frame プレビュー用サムネイル等
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  // プレイリスト (通常はこのモジュールを通らないが保険)
  m3u8: 'application/vnd.apple.mpegurl',
  m3u: 'application/vnd.apple.mpegurl',
};

/**
 * セグメントの Content-Type を拡張子から判定する。
 *
 * S3 のオブジェクトメタデータを信用しない理由:
 * MediaConvert が書き出したオブジェクトの Content-Type は
 * `binary/octet-stream` になることがあり、それをそのまま返すと
 * プレイヤーが再生を拒否する場合がある。拡張子から決めるほうが確実。
 */
export function segmentContentType(relativePath: string): string {
  const path = (relativePath.split('?')[0] ?? '').toLowerCase();
  const dot = path.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return CONTENT_TYPES[path.slice(dot + 1)] ?? 'application/octet-stream';
}

/**
 * 上流 (S3) のレスポンスヘッダから、クライアントへそのまま渡すべきもの。
 *
 * `Content-Range` / `Accept-Ranges` を落とすとシーク (Range リクエスト) が
 * 壊れるため必須。`Content-Encoding` などは中継で壊れる恐れがあるので渡さない。
 */
const PASSTHROUGH_HEADERS: Array<[string, string]> = [
  ['content-length', 'Content-Length'],
  ['content-range', 'Content-Range'],
  ['etag', 'ETag'],
  ['last-modified', 'Last-Modified'],
];

/**
 * セグメント中継レスポンスのヘッダを組み立てる。
 *
 * - `Content-Type` は拡張子から決める (上記の理由)
 * - `Accept-Ranges: bytes` を必ず立てる (シーク可能であることを明示)
 * - キャッシュは `private` (共有キャッシュ禁止 = 有料コンテンツを他人に配らない)。
 *   ただしブラウザ内キャッシュは許可する。HLS はシークや再バッファで同じ
 *   セグメントを何度も取りに来るため、`no-store` にすると毎回サーバを
 *   経由して S3 まで取りに行き、体感が悪化する。
 */
export function buildSegmentHeaders(
  upstream: Headers,
  relativePath: string,
  maxAgeSec = 300,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': segmentContentType(relativePath),
    'Accept-Ranges': 'bytes',
    'Cache-Control': `private, max-age=${maxAgeSec}`,
  };
  for (const [src, dest] of PASSTHROUGH_HEADERS) {
    const value = upstream.get(src);
    if (value) headers[dest] = value;
  }
  return headers;
}

/**
 * このプロキシ自身が配信するセグメントの URL (絶対パス) を組み立てる。
 *
 * プレイリストは `/api/videos/<id>/hls/index_720p.m3u8` で配信されるため、
 * 相対 URI をそのまま残しても同じルートに解決される。しかし
 * 「どこに解決されるか」がプレイヤーの相対解決に依存すると事故りやすいので、
 * 絶対パスで明示する。
 *
 * `videoId` は経路そのものなので encodeURIComponent、
 * `relativePath` はディレクトリ区切り (`/`) を保つため区切りごとに encode する。
 */
export function hlsSegmentProxyUrl(videoId: string, relativePath: string): string {
  const parts = relativePath
    .split('/')
    .filter((p) => p.length > 0)
    .map((p) => encodeURIComponent(p));
  return `/api/videos/${encodeURIComponent(videoId)}/hls/${parts.join('/')}`;
}

/**
 * 「いま配信しているプレイリスト」から見たディレクトリ部分を返す。
 *
 * プレイリスト内の URI は **そのプレイリストの位置からの相対パス**である。
 * MediaConvert の既定出力は全ファイルが同一ディレクトリなので通常は空文字
 * だが、レンディションごとにサブディレクトリを作る構成
 * (`index.m3u8` → `720p/index.m3u8` → `seg1.ts`) もあり得る。
 *
 * この場合 `720p/index.m3u8` の中の `seg1.ts` の実体は `720p/seg1.ts` であり、
 * プレフィックスを付けずに解決すると 404 になる。
 *
 *   playlistRelPath = 'index.m3u8'         → ''
 *   playlistRelPath = '720p/index.m3u8'    → '720p/'
 *   playlistRelPath = 'a/b/index.m3u8'     → 'a/b/'
 */
export function playlistRelativeDir(playlistRelPath: string): string {
  const idx = playlistRelPath.lastIndexOf('/');
  return idx < 0 ? '' : playlistRelPath.slice(0, idx + 1);
}
