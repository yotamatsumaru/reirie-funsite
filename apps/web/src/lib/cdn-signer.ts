import { getSignedUrl as cfSignedUrl } from '@aws-sdk/cloudfront-signer';
import { env } from './env';
import { VIDEO_SIGNED_URL_TTL_SEC } from '@idol/shared';

/**
 * CloudFront 署名付きURL (HLS マスタープレイリスト用)
 * 開発環境では非署名のダミーURLを返す
 */
export function signVideoUrl(
  s3HlsKey: string,
  ttlSec: number = VIDEO_SIGNED_URL_TTL_SEC,
): { url: string; expiresAt: Date } {
  const { videoDomain, keyPairId, privateKey } = env.cloudfront;
  const expiresAt = new Date(Date.now() + ttlSec * 1000);

  if (!videoDomain || !keyPairId || !privateKey) {
    return {
      url: `https://${videoDomain || 'dev-cdn.example.com'}/${s3HlsKey}?dev=1`,
      expiresAt,
    };
  }

  const url = `https://${videoDomain}/${s3HlsKey}`;
  const signed = cfSignedUrl({
    url,
    keyPairId,
    privateKey: privateKey.replace(/\\n/g, '\n'),
    dateLessThan: expiresAt.toISOString(),
  });
  return { url: signed, expiresAt };
}
