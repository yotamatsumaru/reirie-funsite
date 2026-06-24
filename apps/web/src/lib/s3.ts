import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env';

let _client: S3Client | null = null;

export function s3() {
  if (!_client) {
    _client = new S3Client({ region: env.aws.region });
  }
  return _client;
}

export async function presignVideoUpload(key: string, contentType: string): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: env.s3.videoBucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3(), cmd, { expiresIn: 3600 });
}

export async function presignAssetUpload(key: string, contentType: string): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: env.s3.assetBucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3(), cmd, { expiresIn: 3600 });
}

/** アセットバケットが設定済みかどうか */
export function isAssetStorageConfigured(): boolean {
  return Boolean(env.s3.assetBucket);
}

/**
 * バイト列をアセットバケットに直接アップロードし、公開URLを返す。
 * CloudFront ドメインが設定されていればそのURL、なければ S3 のリージョンURLを返す。
 */
export async function putAsset(
  key: string,
  body: Uint8Array | Buffer,
  contentType: string,
): Promise<string> {
  await s3().send(
    new PutObjectCommand({
      Bucket: env.s3.assetBucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  if (env.cloudfront.assetDomain) {
    return `https://${env.cloudfront.assetDomain}/${key}`;
  }
  return `https://${env.s3.assetBucket}.s3.${env.aws.region}.amazonaws.com/${key}`;
}
