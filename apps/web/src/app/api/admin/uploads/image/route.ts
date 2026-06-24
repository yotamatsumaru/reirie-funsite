/**
 * POST /api/admin/uploads/image
 *  - 画像ファイルを multipart/form-data で受け取り、保存して公開URLを返す。
 *  - S3 アセットバケットが設定済み → S3 へアップロードし CloudFront/S3 のURLを返す。
 *  - 未設定（開発環境など）→ public/uploads/products/ に保存し相対URLを返す。
 *
 *  form fields:
 *    file: File (必須, 画像)
 *
 *  response: { url: string }
 */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { isAssetStorageConfigured, putAsset } from '@/lib/s3';

export const runtime = 'nodejs';

const MAX_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

export const POST = handle(async (req: Request) => {
  const session = await requireCapability('MERCH');

  const form = await req.formData().catch(() => null);
  if (!form) throw errors.badRequest('multipart/form-data で送信してください');

  const file = form.get('file');
  if (!(file instanceof File)) throw errors.badRequest('画像ファイル (file) が必要です');

  const contentType = file.type;
  const ext = ALLOWED[contentType];
  if (!ext) {
    throw errors.badRequest('対応していない画像形式です (JPEG/PNG/WebP/GIF/AVIF)');
  }
  if (file.size > MAX_BYTES) {
    throw errors.badRequest('画像サイズは 8MB 以内にしてください');
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const id = crypto.randomUUID();
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const key = `products/${yyyy}/${mm}/${id}.${ext}`;

  let url: string;

  if (isAssetStorageConfigured()) {
    url = await putAsset(key, bytes, contentType);
  } else {
    // ローカル保存フォールバック（開発環境）
    const publicDir = path.join(process.cwd(), 'public', 'uploads', 'products', `${yyyy}`, mm);
    await fs.mkdir(publicDir, { recursive: true });
    await fs.writeFile(path.join(publicDir, `${id}.${ext}`), bytes);
    url = `/uploads/products/${yyyy}/${mm}/${id}.${ext}`;
  }

  await logAudit({
    userId: session.user.id,
    action: 'admin.product.image_uploaded',
    resource: `image:${key}`,
    metadata: { contentType, size: file.size, storage: isAssetStorageConfigured() ? 's3' : 'local' },
  });

  return NextResponse.json({ url });
});
