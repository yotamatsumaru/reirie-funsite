/**
 * POST /api/admin/contents/images
 *
 * ブログ記事・ギャラリー本文に挿入する画像をアップロードし、挿入用の URL を返す。
 *
 * ## なぜ /api/admin/uploads/image と別に用意するのか
 *
 * 既存の汎用アップロードは商品画像向けに作られており、
 *   - `requireCapability('MERCH')` … 物販権限が必要
 *   - S3 未設定だと `unprocessable` で即失敗
 * という前提だった。
 *
 * このため記事担当者 (CONTENT 権限) がエディタの画像ボタンを押すと 403 になり、
 * S3 未設定の環境では誰も本文に画像を入れられなかった。
 * 本文画像は記事編集の一部なので CONTENT 権限で扱えるべきで、
 * 保存先も他の画像と同じ二段構え (S3 → DB フォールバック) に揃える。
 *
 * form fields:
 *   file: File (必須, 画像)
 *
 * response: { url: string, id: string, storage: 's3' | 'db' }
 */
import { NextResponse } from 'next/server';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { validateContentBodyImage } from '@/lib/content-body-image';
import { saveContentBodyImage } from '@/lib/content-body-image-store';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireCapability('CONTENT');

  const form = await req.formData().catch(() => null);
  if (!form) throw errors.badRequest('multipart/form-data で送信してください');

  const file = form.get('file');
  if (!(file instanceof File)) throw errors.badRequest('画像ファイル (file) が必要です');

  const check = validateContentBodyImage({ contentType: file.type, sizeBytes: file.size });
  if (!check.ok) {
    if (check.error.kind === 'missing') {
      throw errors.badRequest('画像の形式を判別できませんでした。別のファイルをお試しください。');
    }
    throw errors.badRequest(check.error.message);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const saved = await saveContentBodyImage({
    bytes,
    contentType: check.contentType,
    ext: check.ext,
    fileName: file.name || null,
    uploadedBy: session.user.id,
  });

  await logAudit({
    userId: session.user.id,
    action: 'admin.content.image_uploaded',
    resource: `content-body-image:${saved.id}`,
    metadata: {
      contentType: check.contentType,
      size: bytes.byteLength,
      storage: saved.storage,
      fileName: file.name || null,
    },
  });

  return NextResponse.json({ id: saved.id, url: saved.url, storage: saved.storage });
});
