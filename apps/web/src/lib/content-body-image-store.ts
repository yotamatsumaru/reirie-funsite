/**
 * ブログ本文画像の保存処理 (prisma / S3 に触る側)。
 *
 * 検証ロジックは `content-body-image.ts` にある。
 * 保存先の決定方針は SiteImage / ProductImage / VideoThumbnail と同じ二段構え:
 *
 *   1. S3 アセットバケット設定済み → S3 へ PUT し、url は外部 URL (data は null)
 *   2. 未設定 → バイト列を DB に保存し、url は /api/media/content-body-image/{id}
 *
 * ローカルディスクは採用しない。standalone build では配信ディレクトリと
 * 書き込み先がズレ、再ビルドで消え、PM2 cluster 間で不整合になるため。
 */
import crypto from 'node:crypto';
import { prisma } from '@idol/db';
import { isAssetStorageConfigured, putAsset } from './s3';
import { contentBodyImageMediaPath } from './content-body-image';

export type StoredContentBodyImage = {
  id: string;
  url: string;
  storage: 's3' | 'db';
};

/**
 * 本文画像を保存し、挿入用の URL を返す。
 *
 * S3 経路でも DB にメタデータ行を残すのは、後から
 * 「いつ・誰が上げた画像か」を棚卸しできるようにするため。
 * バイト列 (data) は S3 経路では持たない。
 */
export async function saveContentBodyImage(params: {
  bytes: Buffer;
  contentType: string;
  ext: string;
  fileName?: string | null;
  uploadedBy?: string | null;
}): Promise<StoredContentBodyImage> {
  const { bytes, contentType, ext, fileName = null, uploadedBy = null } = params;
  const id = crypto.randomUUID();

  if (isAssetStorageConfigured()) {
    // キーに UUID を含めるので、同名ファイルを上げ直しても
    // CloudFront / ブラウザのキャッシュと衝突しない (immutable 配信のため)。
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const key = `content-body-images/${yyyy}/${mm}/${id}.${ext}`;
    const url = await putAsset(key, bytes, contentType);

    await prisma.contentBodyImage.create({
      data: {
        id,
        url,
        contentType,
        fileName,
        sizeBytes: bytes.byteLength,
        uploadedBy,
        // S3 に実体があるので DB にはバイト列を持たない。
        data: null,
      },
    });
    return { id, url, storage: 's3' };
  }

  // DB 保存。url は自サーバの配信エンドポイントを指す。
  const url = contentBodyImageMediaPath(id);
  await prisma.contentBodyImage.create({
    data: {
      id,
      url,
      contentType,
      fileName,
      sizeBytes: bytes.byteLength,
      uploadedBy,
      data: bytes,
    },
  });
  return { id, url, storage: 'db' };
}
