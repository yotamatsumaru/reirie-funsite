/**
 * POST /api/admin/uploads/image
 *  - 画像ファイルを multipart/form-data で受け取り、S3 アセットバケットへ保存して公開URLを返す。
 *  - S3 が未設定の環境では商品画像は DB 保存方式 (/api/admin/products/[id]/images に
 *    multipart で直接アップロード) を使うため、このエンドポイントは S3 専用とする。
 *
 *  form fields:
 *    file: File (必須, 画像)
 *
 *  response: { url: string }
 */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { isAssetStorageConfigured, putAsset } from '@/lib/s3';
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from '@/lib/product-image';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireCapability('MERCH');

  if (!isAssetStorageConfigured()) {
    // S3 未設定環境では商品画像は /api/admin/products/[id]/images に
    // multipart で直接アップロードする (DB 保存)。汎用アップロード先は無い。
    throw errors.unprocessable(
      'このエンドポイントは S3 アセットバケット設定時のみ利用できます。商品画像は商品編集画面からアップロードしてください。',
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) throw errors.badRequest('multipart/form-data で送信してください');

  const file = form.get('file');
  if (!(file instanceof File)) throw errors.badRequest('画像ファイル (file) が必要です');

  const contentType = file.type;
  const ext = ALLOWED_IMAGE_TYPES[contentType];
  if (!ext) {
    throw errors.badRequest('対応していない画像形式です (JPEG/PNG/WebP/GIF/AVIF)');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw errors.badRequest('画像サイズは 8MB 以内にしてください');
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const id = crypto.randomUUID();
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const key = `products/${yyyy}/${mm}/${id}.${ext}`;

  const url = await putAsset(key, bytes, contentType);

  await logAudit({
    userId: session.user.id,
    action: 'admin.product.image_uploaded',
    resource: `image:${key}`,
    metadata: { contentType, size: file.size, storage: 's3' },
  });

  return NextResponse.json({ url });
});
