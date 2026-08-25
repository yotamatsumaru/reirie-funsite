import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
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

/**
 * オブジェクトを 1 件削除する。
 *
 * S3 の DeleteObject は「存在しないキー」でも成功扱い (冪等) なので、
 * 事前の存在確認は不要。バケット未設定 / キー空文字は何もしない
 * (ローカル開発や S3 未設定環境で呼ばれても落とさないため)。
 */
export async function deleteObject(bucket: string, key: string): Promise<void> {
  if (!bucket || !key) return;
  await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * プレフィックス配下のオブジェクトをすべて削除する。
 *
 * ## なぜ必要か
 * HLS 出力は `hls/<videoId>/index.m3u8` の他に画質別プレイリストと
 * 大量の `.ts` セグメント、サムネイルのコマ画像が同じ階層に生成される。
 * 動画 1 本の削除でこれらが残ると、二度と参照されないファイルが
 * ストレージ課金だけ発生し続ける。
 *
 * ## 実装上の注意
 * - ListObjectsV2 は 1 回で最大 1000 件しか返さないため、
 *   `IsTruncated` を見て継続トークンで回し切る
 *   (長尺動画はセグメントが 1000 を超える)。
 * - DeleteObjects も 1 回 1000 件が上限なので、取得単位でそのまま投げる。
 * - 誤って広範囲を消さないよう、prefix は末尾 `/` を必須とする。
 *   `hls/abc` を許すと `hls/abcdef/...` まで巻き込むため。
 *
 * @returns 削除したオブジェクト数
 */
export async function deleteByPrefix(bucket: string, prefix: string): Promise<number> {
  if (!bucket || !prefix) return 0;
  if (!prefix.endsWith('/')) {
    // 呼び出し側のミスを黙って通すと事故になるので明示的に落とす。
    throw new Error(`deleteByPrefix: prefix must end with "/" (got: ${prefix})`);
  }

  let deleted = 0;
  let continuationToken: string | undefined;

  do {
    const listed = await s3().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    const objects = (listed.Contents ?? [])
      .map((o) => o.Key)
      .filter((k): k is string => typeof k === 'string' && k.length > 0);

    if (objects.length > 0) {
      await s3().send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      deleted += objects.length;
    }

    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);

  return deleted;
}
