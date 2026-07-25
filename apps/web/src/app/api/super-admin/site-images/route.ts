/**
 * GET    /api/super-admin/site-images — サイト画像一覧 (スロット別) を取得
 * POST   /api/super-admin/site-images — 画像をアップロード (multipart/form-data)
 * DELETE /api/super-admin/site-images — 指定スロットの画像を削除
 *
 * SUPER_ADMIN 限定。保存は S3 (設定時) または DB (フォールバック)。
 *
 * form fields (POST):
 *   slot: string (必須, SITE_IMAGE_SLOTS のいずれか)
 *   file: File   (必須, 画像)
 *
 * query/body (DELETE):
 *   ?slot=... または JSON { slot }
 */
import { NextResponse } from 'next/server';
import {
  ALLOWED_SITE_IMAGE_TYPES,
  MAX_SITE_IMAGE_BYTES,
  isSiteImageSlot,
} from '@idol/shared';
import { requireSuperAdmin, requireSuperAdminView } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import {
  listSiteImages,
  saveSiteImage,
  deleteSiteImage,
} from '@/lib/site-image';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireSuperAdminView();
  const items = await listSiteImages();
  return NextResponse.json({ items });
});

export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();

  const form = await req.formData().catch(() => null);
  if (!form) throw errors.badRequest('multipart/form-data で送信してください');

  const slot = form.get('slot');
  if (typeof slot !== 'string' || !isSiteImageSlot(slot)) {
    throw errors.badRequest('スロット (slot) が不正です');
  }

  const file = form.get('file');
  if (!(file instanceof File)) throw errors.badRequest('画像ファイル (file) が必要です');

  const ext = ALLOWED_SITE_IMAGE_TYPES[file.type];
  if (!ext) {
    throw errors.badRequest('対応していない画像形式です (JPEG/PNG/WebP/GIF/AVIF)');
  }
  if (file.size > MAX_SITE_IMAGE_BYTES) {
    throw errors.badRequest('画像サイズは 8MB 以内にしてください');
  }
  if (file.size === 0) {
    throw errors.badRequest('空のファイルです');
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const fileName = typeof file.name === 'string' && file.name.trim() !== '' ? file.name : null;

  const stored = await saveSiteImage({
    slot,
    bytes,
    contentType: file.type,
    ext,
    fileName,
  });

  await logAudit({
    userId: session.user.id,
    action: 'setting.site_image_upload',
    resource: `site-image:${slot}`,
    metadata: { slot, storage: stored.storage, size: file.size, contentType: file.type },
  });

  return NextResponse.json({ ok: true, item: stored }, { status: 201 });
});

export const DELETE = handle(async (req: Request) => {
  const session = await requireSuperAdmin();

  const url = new URL(req.url);
  let slot = url.searchParams.get('slot');
  if (!slot) {
    const body = await req.json().catch(() => null);
    if (body && typeof body.slot === 'string') slot = body.slot;
  }
  if (!slot || !isSiteImageSlot(slot)) {
    throw errors.badRequest('スロット (slot) が不正です');
  }

  await deleteSiteImage(slot);

  await logAudit({
    userId: session.user.id,
    action: 'setting.site_image_delete',
    resource: `site-image:${slot}`,
    metadata: { slot },
  });

  return NextResponse.json({ ok: true });
});
