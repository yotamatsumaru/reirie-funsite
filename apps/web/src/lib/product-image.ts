/**
 * 商品画像の保存ヘルパ。
 *
 * 保存先の決定ロジック (本番 EC2 standalone + PM2 cluster でも確実に動くように):
 *   1. S3 アセットバケットが設定済み → S3 へアップロードし CDN/S3 の URL を返す。
 *   2. 未設定 → 画像バイト列を DB (ProductImage.data) に保存し、
 *      /api/media/product-image/{id} 経由で配信する。
 *
 * かつてはローカルディスク (process.cwd()/public/uploads/...) に書いていたが、
 * standalone build では配信ディレクトリ (.next/standalone/apps/web/public) と
 * 書き込み先がズレ、さらに再ビルドで消える / cluster 間で不整合になるため廃止した。
 */
import { prisma } from '@idol/db';
import crypto from 'node:crypto';
import { isAssetStorageConfigured, putAsset } from './s3';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB

export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

export type StoredProductImage = {
  id: string;
  url: string;
  storage: 's3' | 'db';
};

/**
 * 画像バイト列を保存し ProductImage レコードを作成する。
 * - sortOrder は呼び出し側で算出済みの値を渡す。
 * - S3 設定済みなら S3 に置き、url は外部 URL。data は null。
 * - 未設定なら data に格納し、url は /api/media/product-image/{id}。
 */
export async function createProductImageFromBytes(params: {
  productId: string;
  bytes: Buffer;
  contentType: string;
  ext: string;
  alt: string | null;
  sortOrder: number;
}): Promise<StoredProductImage> {
  const { productId, bytes, contentType, ext, alt, sortOrder } = params;

  if (isAssetStorageConfigured()) {
    const id = crypto.randomUUID();
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const key = `products/${yyyy}/${mm}/${id}.${ext}`;
    const url = await putAsset(key, bytes, contentType);
    const created = await prisma.productImage.create({
      data: { productId, url, alt, sortOrder },
      select: { id: true, url: true },
    });
    return { id: created.id, url: created.url, storage: 's3' };
  }

  // DB 保存フォールバック: 先に id を確定させ、url を埋める
  const created = await prisma.productImage.create({
    data: {
      productId,
      url: '', // 後で id ベースの URL に更新
      alt,
      sortOrder,
      data: bytes,
      contentType,
    },
    select: { id: true },
  });
  const url = `/api/media/product-image/${created.id}`;
  await prisma.productImage.update({ where: { id: created.id }, data: { url } });
  return { id: created.id, url, storage: 'db' };
}
