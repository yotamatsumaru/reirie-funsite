/**
 * HLS プレイリストプロキシの URL を組み立てる。
 *
 * DB の `s3HlsKey` (例 `hls/<videoId>/index.m3u8`) から
 * ファイル名部分だけを取り出し、
 * `/api/videos/<videoId>/hls/<filename>` を返す。
 */

/** `s3HlsKey` からファイル名 (`index.m3u8`) を取り出す */
export function hlsFileName(s3HlsKey: string): string {
  const key = s3HlsKey.replace(/^\/+/, '');
  const idx = key.lastIndexOf('/');
  const name = idx >= 0 ? key.slice(idx + 1) : key;
  return name || 'index.m3u8';
}

/** プレイリストプロキシの相対URL */
export function hlsProxyUrl(videoId: string, s3HlsKey: string): string {
  return `/api/videos/${encodeURIComponent(videoId)}/hls/${hlsFileName(s3HlsKey)}`;
}
