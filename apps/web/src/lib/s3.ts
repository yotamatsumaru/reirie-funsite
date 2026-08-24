import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
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

/**
 * 指定バケットにオブジェクトが存在するかを確認する (HeadObject)。
 *
 * MediaConvert の完了通知が届かなかった場合に、HLS 出力
 * (`hls/<videoId>/index.m3u8`) が実際に生成済みかを確かめて
 * 手動 READY 化を許可するために使う。
 *
 * 404 / NotFound は「存在しない」として false を返し、
 * それ以外のエラー (権限不足など) は呼び出し側で扱えるよう throw する。
 */
export async function objectExists(bucket: string, key: string): Promise<boolean> {
  if (!bucket || !key) return false;
  try {
    await s3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    const code = err?.$metadata?.httpStatusCode;
    if (err?.name === 'NotFound' || err?.name === 'NoSuchKey' || code === 404) {
      return false;
    }
    throw e;
  }
}
