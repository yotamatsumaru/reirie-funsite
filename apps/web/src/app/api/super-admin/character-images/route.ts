/**
 * GET    /api/super-admin/character-images — キャラクター画像一覧 (ポーズ別) を取得
 * POST   /api/super-admin/character-images — 画像をアップロード (multipart/form-data)
 * DELETE /api/super-admin/character-images — 指定ポーズの画像を削除
 *
 * SUPER_ADMIN 限定。保存は S3 (設定時) または DB (フォールバック)。
 * あっち向いてホイのキャラクター (idle/rock/scissors/paper/up/down/left/right)
 * の表示画像を、コード変更・再デプロイ不要で差し替えられるようにする。
 *
 * form fields (POST):
 *   slot: string    (必須, CHARACTER_IMAGE_SLOTS のいずれか)
 *   variant: number (任意, 1〜CHARACTER_IMAGE_VARIANTS_PER_SLOT。未指定は 1)
 *   file: File      (必須, 画像)
 *
 * query/body (DELETE):
 *   ?slot=...&variant=... または JSON { slot, variant }
 */
import { NextResponse } from 'next/server';
import {
  ALLOWED_CHARACTER_IMAGE_TYPES,
  MAX_CHARACTER_IMAGE_BYTES,
  isCharacterImageSlot,
  isCharacterImageVariant,
} from '@idol/shared';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import {
  listCharacterImages,
  saveCharacterImage,
  deleteCharacterImage,
} from '@/lib/character-image';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireSuperAdmin();
  const items = await listCharacterImages();
  return NextResponse.json({ items });
});

export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();

  const form = await req.formData().catch(() => null);
  if (!form) throw errors.badRequest('multipart/form-data で送信してください');

  const slot = form.get('slot');
  if (typeof slot !== 'string' || !isCharacterImageSlot(slot)) {
    throw errors.badRequest('ポーズ (slot) が不正です');
  }

  // variant (パターン番号)。未指定は 1 として扱う (後方互換)。
  const variantRaw = form.get('variant');
  const variant = variantRaw == null || variantRaw === '' ? 1 : Number(variantRaw);
  if (!isCharacterImageVariant(variant)) {
    throw errors.badRequest('パターン番号 (variant) が不正です');
  }

  const file = form.get('file');
  if (!(file instanceof File)) throw errors.badRequest('画像ファイル (file) が必要です');

  const ext = ALLOWED_CHARACTER_IMAGE_TYPES[file.type];
  if (!ext) {
    throw errors.badRequest('対応していない画像形式です (JPEG/PNG/WebP/GIF/AVIF)');
  }
  if (file.size > MAX_CHARACTER_IMAGE_BYTES) {
    throw errors.badRequest('画像サイズは 8MB 以内にしてください');
  }
  if (file.size === 0) {
    throw errors.badRequest('空のファイルです');
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const fileName = typeof file.name === 'string' && file.name.trim() !== '' ? file.name : null;

  const stored = await saveCharacterImage({
    slot,
    variant,
    bytes,
    contentType: file.type,
    ext,
    fileName,
  });

  await logAudit({
    userId: session.user.id,
    action: 'setting.character_image_upload',
    resource: `character-image:${slot}:${variant}`,
    metadata: { slot, variant, storage: stored.storage, size: file.size, contentType: file.type },
  });

  return NextResponse.json({ ok: true, item: stored }, { status: 201 });
});

export const DELETE = handle(async (req: Request) => {
  const session = await requireSuperAdmin();

  const url = new URL(req.url);
  let slot = url.searchParams.get('slot');
  let variantRaw: string | number | null = url.searchParams.get('variant');
  if (!slot) {
    const body = await req.json().catch(() => null);
    if (body && typeof body.slot === 'string') slot = body.slot;
    if (body && (typeof body.variant === 'number' || typeof body.variant === 'string')) {
      variantRaw = body.variant;
    }
  }
  if (!slot || !isCharacterImageSlot(slot)) {
    throw errors.badRequest('ポーズ (slot) が不正です');
  }
  // variant 未指定は 1 として扱う (後方互換)。
  const variant = variantRaw == null || variantRaw === '' ? 1 : Number(variantRaw);
  if (!isCharacterImageVariant(variant)) {
    throw errors.badRequest('パターン番号 (variant) が不正です');
  }

  await deleteCharacterImage(slot, variant);

  await logAudit({
    userId: session.user.id,
    action: 'setting.character_image_delete',
    resource: `character-image:${slot}:${variant}`,
    metadata: { slot, variant },
  });

  return NextResponse.json({ ok: true });
});
