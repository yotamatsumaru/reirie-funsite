import { getSignedUrl as cfSignedUrl } from '@aws-sdk/cloudfront-signer';
import { env } from './env';
import { VIDEO_SIGNED_URL_TTL_SEC } from '@idol/shared';

/** CloudFront 署名付き URL を発行できる設定が揃っているか */
export function isVideoCdnConfigured(): boolean {
  const { videoDomain, keyPairId, privateKey } = env.cloudfront;
  return Boolean(videoDomain && keyPairId && privateKey);
}

/**
 * CloudFront 署名付きURL (HLS マスタープレイリスト用)
 *
 * `signed: false` の場合は署名設定が未完了で、返した URL では実際には再生できない
 * (CloudFront が 403 を返す)。呼び出し側でユーザーに明示するために使う。
 * 開発環境では非署名のダミーURLを返す。
 */
export function signVideoUrl(
  s3HlsKey: string,
  ttlSec: number = VIDEO_SIGNED_URL_TTL_SEC,
): { url: string; expiresAt: Date; signed: boolean } {
  const { videoDomain, keyPairId, privateKey } = env.cloudfront;
  const expiresAt = new Date(Date.now() + ttlSec * 1000);

  if (!videoDomain || !keyPairId || !privateKey) {
    return {
      url: `https://${videoDomain || 'dev-cdn.example.com'}/${s3HlsKey}?dev=1`,
      expiresAt,
      signed: false,
    };
  }

  const url = `https://${videoDomain}/${s3HlsKey}`;
  const signed = cfSignedUrl({
    url,
    keyPairId,
    privateKey: privateKey.replace(/\\n/g, '\n'),
    dateLessThan: expiresAt.toISOString(),
  });
  return { url: signed, expiresAt, signed: true };
}

/**
 * 動画サムネイルの表示用 URL を解決する。
 *
 * MediaConvert が出力するサムネイルは非公開の出力バケットに置かれるため、
 * DB には S3 キー (例 `hls/<videoId>/thumbnail.0000000.jpg`) を保存し、
 * 表示時に CloudFront 署名付き URL へ変換する。
 *
 * - `http(s)://` から始まる値 (管理画面から手動で設定した外部URL等) はそのまま返す
 * - 署名設定が未完了なら null を返す (壊れた画像を出さずプレースホルダにフォールバック)
 *
 * @param value DB の Video.thumbnailUrl
 */
export function resolveThumbnailUrl(
  value: string | null | undefined,
  ttlSec: number = VIDEO_SIGNED_URL_TTL_SEC,
): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (!isVideoCdnConfigured()) return null;
  const { url } = signVideoUrl(value.replace(/^\/+/, ''), ttlSec);
  return url;
}
