/**
 * 動画サムネイルの設定 API。
 *
 *   POST   /api/admin/videos/[id]/thumbnail  … 画像ファイルをアップロードして設定
 *   DELETE /api/admin/videos/[id]/thumbnail  … サムネイルを未設定に戻す
 *
 * ## なぜメタ情報 PATCH と別エンドポイントなのか
 *
 * `PATCH /api/admin/videos/[id]` は JSON (application/json) を受ける前提で、
 * タイトル等の差分だけを送る設計になっている。画像は multipart/form-data
 * なので同じハンドラに混ぜると本文の扱いが二重になり読みにくい。
 * 既存の画像アップロード (`/api/admin/uploads/image`,
 * `/api/super-admin/site-images`) も専用エンドポイントを立てているので、
 * その慣習に合わせる。
 *
 * なお「URL を直接指定する」経路は PATCH 側 (`thumbnailUrl`) が担当する。
 * S3 もアップロードも使えない環境や、外部CDNの画像を使いたい場合の逃げ道。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { validateThumbnailFile } from '@/lib/video-thumbnail';
import { saveVideoThumbnail, clearVideoThumbnail } from '@/lib/video-thumbnail-store';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireCapability('CONTENT');
  const { id } = await ctx.params;

  const video = await prisma.video.findUnique({ where: { id }, select: { id: true } });
  if (!video) throw errors.notFound('動画が見つかりません');

  const form = await req.formData().catch(() => null);
  if (!form) throw errors.badRequest('multipart/form-data で送信してください');

  const file = form.get('file');
  if (!(file instanceof File)) throw errors.badRequest('画像ファイル (file) が必要です');

  const check = validateThumbnailFile(file.type, file.size);
  if (!check.ok) throw errors.badRequest(check.message);

  const bytes = Buffer.from(await file.arrayBuffer());
  const saved = await saveVideoThumbnail({
    videoId: id,
    bytes,
    contentType: file.type,
    ext: check.ext,
    fileName: file.name || null,
  });

  await logAudit({
    userId: session.user.id,
    action: 'admin.video.thumbnail_set',
    resource: `video:${id}`,
    metadata: {
      source: 'upload',
      storage: saved.storage,
      contentType: file.type,
      sizeBytes: file.size,
      fileName: file.name || null,
    },
  });

  return NextResponse.json({
    ok: true,
    thumbnailUrl: saved.url,
    storage: saved.storage,
    message: 'サムネイルを設定しました',
  });
});

export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireCapability('CONTENT');
  const { id } = await ctx.params;

  const video = await prisma.video.findUnique({ where: { id }, select: { id: true } });
  if (!video) throw errors.notFound('動画が見つかりません');

  await clearVideoThumbnail(id);

  await logAudit({
    userId: session.user.id,
    action: 'admin.video.thumbnail_cleared',
    resource: `video:${id}`,
  });

  return NextResponse.json({ ok: true, message: 'サムネイルを削除しました' });
});
