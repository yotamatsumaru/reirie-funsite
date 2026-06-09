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
