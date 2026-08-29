/**
 * MyRoom 家具画像の保存ヘルパ。
 *
 * 保存先の決定ロジック (本番 EC2 standalone + PM2 cluster でも確実に動くように):
 *   1. S3 アセットバケットが設定済み → S3 へアップロードし CDN/S3 の URL を返す。
 *   2. 未設定 → 画像バイト列を DB (MyRoomFurniture.data) に保存し、
 *      /api/media/myroom-furniture/{id} 経由で配信する。
 *
 * ローカルディスク (process.cwd()/public/uploads/...) には書かない。
 * standalone build では配信ディレクトリ (.next/standalone/apps/web/public) と
 * 書き込み先がズレ、さらに再ビルドで消える / cluster 間で不整合になるため。
 * (product-image.ts / content-body-image-store.ts と同じ方針)
 */
import { prisma } from '@idol/db';
import { isAssetStorageConfigured, putAsset } from './s3';

export type StoredMyRoomFurnitureImage = {
  url: string;
  storage: 's3' | 'db';
};

/**
 * 既存の家具レコードに画像を保存する (差し替えを含む)。
 *
 * 【差し替え時に古い画像をどうするか】
 *  - DB 保存の場合は data を上書きするので、古いバイト列は自然に消える。
 *  - S3 の場合は古いオブジェクトが残る。ここで削除しないのは、
 *    削除に失敗したときに「画像は消えたが URL は残る」より
 *    「使われないオブジェクトが残る」ほうが安全だから。
 *    S3 のライフサイクルルールでの整理を想定している。
 *
 * 【キャッシュについて】
 * url に ?v=<timestamp> を付けて返す。DB 保存経路の配信 API は
 * immutable な長期キャッシュを返すため、これがないと差し替えても
 * ブラウザが古い画像を表示し続ける。
 */
export async function saveMyRoomFurnitureImage(params: {
  furnitureId: string;
  bytes: Buffer;
  contentType: string;
  ext: string;
  fileName: string | null;
}): Promise<StoredMyRoomFurnitureImage> {
  const { furnitureId, bytes, contentType, ext, fileName } = params;

  if (isAssetStorageConfigured()) {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const key = `myroom-furniture/${yyyy}/${mm}/${furnitureId}.${ext}`;
    const uploadedUrl = await putAsset(key, bytes, contentType);
    await prisma.myRoomFurniture.update({
      where: { id: furnitureId },
      data: {
        imageUrl: uploadedUrl,
        contentType,
        fileName,
        sizeBytes: bytes.byteLength,
        // S3 に移した場合、DB 側のバイト列は不要なので明示的に消す
        // (同じ家具を DB 保存 → S3 設定後に再アップロードした場合に残らないように)。
        data: null,
      },
    });
    return { url: uploadedUrl, storage: 's3' };
  }

  // DB 保存フォールバック
  const url = `/api/media/myroom-furniture/${furnitureId}?v=${Date.now()}`;
  await prisma.myRoomFurniture.update({
    where: { id: furnitureId },
    data: {
      imageUrl: url,
      contentType,
      fileName,
      sizeBytes: bytes.byteLength,
      data: bytes,
    },
  });
  return { url, storage: 'db' };
}
