/**
 * ブログ本文動画の保存処理 (prisma / S3 に触る側)。
 *
 * 検証ロジックは `content-body-video.ts` にある。
 * 保存先の決定方針は ContentBodyImage / SiteImage / VideoThumbnail と同じ二段構え:
 *
 *   1. S3 アセットバケット設定済み → S3 へ PUT し、url は外部 URL (data は null)
 *   2. 未設定 → バイト列を DB に保存し、url は /api/media/content-body-video/{id}
 *
 * ローカルディスクは採用しない。standalone build では配信ディレクトリと
 * 書き込み先がズレ、再ビルドで消え、PM2 cluster 間で不整合になるため。
 */
import crypto from 'node:crypto';
import { prisma } from '@idol/db';
import { isAssetStorageConfigured, putAsset } from './s3';
import { contentBodyVideoMediaPath } from './content-body-video';

export type StoredContentBodyVideo = {
  id: string;
  url: string;
  storage: 's3' | 'db';
};

/**
 * 本文動画を保存し、挿入用の URL を返す。
 *
 * S3 経路でも DB にメタデータ行を残すのは、後から
 * 「いつ・誰が上げた動画か」を棚卸しできるようにするため。
 * バイト列 (data) は S3 経路では持たない。
 */
export async function saveContentBodyVideo(params: {
  bytes: Buffer;
  contentType: string;
  ext: string;
  fileName?: string | null;
  posterUrl?: string | null;
  durationSeconds?: number | null;
  uploadedBy?: string | null;
}): Promise<StoredContentBodyVideo> {
  const {
    bytes,
    contentType,
    ext,
    fileName = null,
    posterUrl = null,
    uploadedBy = null,
  } = params;

  // 尺はブラウザ側の推定値なので、壊れた値 (Infinity / NaN / 負) は捨てる。
  // Prisma の Int に Infinity を渡すと実行時エラーになるため、ここで正規化する。
  const raw = params.durationSeconds;
  const durationSeconds =
    typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;

  const id = crypto.randomUUID();

  if (isAssetStorageConfigured()) {
    // キーに UUID を含めるので、同名ファイルを上げ直しても
    // CloudFront / ブラウザのキャッシュと衝突しない (immutable 配信のため)。
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const key = `content-body-videos/${yyyy}/${mm}/${id}.${ext}`;
    const url = await putAsset(key, bytes, contentType);

    await prisma.contentBodyVideo.create({
      data: {
        id,
        url,
        contentType,
        fileName,
        sizeBytes: bytes.byteLength,
        posterUrl,
        durationSeconds,
        uploadedBy,
        // S3 に実体があるので DB にはバイト列を持たない。
        data: null,
      },
    });
    return { id, url, storage: 's3' };
  }

  // DB 保存。url は自サーバの配信エンドポイントを指す。
  const url = contentBodyVideoMediaPath(id);
  await prisma.contentBodyVideo.create({
    data: {
      id,
      url,
      contentType,
      fileName,
      sizeBytes: bytes.byteLength,
      posterUrl,
      durationSeconds,
      uploadedBy,
      data: bytes,
    },
  });
  return { id, url, storage: 'db' };
}
