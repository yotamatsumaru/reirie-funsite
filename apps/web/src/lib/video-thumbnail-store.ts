/**
 * 動画サムネイルの保存処理 (prisma / S3 に触る側)。
 *
 * 判定・検証の純粋関数は `video-thumbnail.ts` にある。
 * 保存先の決定方針・なぜアセットバケットを使うのかは
 * そちらのファイル冒頭のコメントを参照。
 */
import crypto from 'node:crypto';
import { prisma } from '@idol/db';
import { isAssetStorageConfigured, putAsset } from './s3';
import { videoThumbnailMediaPath } from './video-thumbnail';

export type SavedThumbnail = {
  /** `Video.thumbnailUrl` に書き込んだ値 */
  url: string;
  storage: 's3' | 'db';
};

/**
 * サムネイル画像を保存し、`Video.thumbnailUrl` を更新する。
 *
 * S3 が使えるなら S3、使えないなら DB (`video_thumbnails`)。
 * どちらの場合も **もう一方の保存先の残骸を必ず消す**。
 * これを怠ると
 *   - S3 へ移行した後も古い DB バイト列が残って容量を食い続ける
 *   - URL 直接指定に切り替えたのに DB 版が配信され続ける
 * といった事故になる。
 *
 * トランザクションで包む理由: `thumbnailUrl` と実体の保存が片方だけ成功すると
 * 「URL は指すのに実体が無い (= 壊れた画像)」か
 * 「実体はあるのに参照されない (= 見えないゴミ)」のどちらかになる。
 */
export async function saveVideoThumbnail(params: {
  videoId: string;
  bytes: Buffer;
  contentType: string;
  ext: string;
  fileName?: string | null;
}): Promise<SavedThumbnail> {
  const { videoId, bytes, contentType, ext, fileName = null } = params;

  if (isAssetStorageConfigured()) {
    // ファイル名に UUID を挟むのは、同じ動画のサムネイルを差し替えたときに
    // CloudFront / ブラウザのキャッシュを確実に外すため (immutable で配信している)。
    const key = `video-thumbnails/${videoId}/${crypto.randomUUID()}.${ext}`;
    const url = await putAsset(key, bytes, contentType);
    await prisma.$transaction([
      prisma.videoThumbnail.deleteMany({ where: { videoId } }),
      prisma.video.update({ where: { id: videoId }, data: { thumbnailUrl: url } }),
    ]);
    return { url, storage: 's3' };
  }

  // DB 保存。updatedAt をキャッシュバスターに使うため、まず実体を書いて
  // 確定した updatedAt から URL を組み立て、続けて thumbnailUrl を更新する。
  const written = await prisma.videoThumbnail.upsert({
    where: { videoId },
    create: { videoId, data: bytes, contentType, fileName, sizeBytes: bytes.byteLength },
    update: { data: bytes, contentType, fileName, sizeBytes: bytes.byteLength },
    select: { updatedAt: true },
  });
  const url = videoThumbnailMediaPath(videoId, written.updatedAt);
  await prisma.video.update({ where: { id: videoId }, data: { thumbnailUrl: url } });
  return { url, storage: 'db' };
}

/**
 * サムネイルを未設定に戻す。
 *
 * 自動生成分 (S3 キー) を消した場合、`sync` を叩くとまた自動で入る点は
 * 運用上の仕様として許容する (「自動生成に戻す」手段を別に用意するより素直)。
 */
export async function clearVideoThumbnail(videoId: string): Promise<void> {
  await prisma.$transaction([
    prisma.videoThumbnail.deleteMany({ where: { videoId } }),
    prisma.video.update({ where: { id: videoId }, data: { thumbnailUrl: null } }),
  ]);
}

/**
 * DB 保存された実体だけを消す (`thumbnailUrl` は触らない)。
 *
 * 「URL 直接指定」に切り替えたときに使う。thumbnailUrl は新しい外部 URL に
 * 書き換わるので、残った DB のバイト列はもう誰からも参照されないゴミになる。
 */
export async function deleteStoredThumbnailData(videoId: string): Promise<void> {
  await prisma.videoThumbnail.deleteMany({ where: { videoId } });
}
