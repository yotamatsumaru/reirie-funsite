/**
 * 誕生日メールテンプレート (年ごと) の取得・保存・画像アップロード/削除。
 *
 *   GET    /api/super-admin/birthday/template?year=2026  — 指定年のテンプレート取得
 *   PUT    /api/super-admin/birthday/template            — テンプレート保存 (JSON, upsert)
 *   POST   /api/super-admin/birthday/template            — 画像アップロード (multipart)
 *   DELETE /api/super-admin/birthday/template?year=2026  — 画像削除
 *
 * SUPER_ADMIN 限定。保存は S3 (設定時) または DB (フォールバック)。
 */
import { NextResponse } from 'next/server';
import {
  BirthdayMailTemplateSchema,
  ALLOWED_SITE_IMAGE_TYPES,
  MAX_SITE_IMAGE_BYTES,
  BIRTHDAY_MAIL_YEAR_MIN,
  BIRTHDAY_MAIL_YEAR_MAX,
} from '@idol/shared';
import { requireSuperAdmin, requireSuperAdminView } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import {
  getBirthdayTemplate,
  upsertBirthdayTemplate,
  saveBirthdayTemplateImage,
  clearBirthdayTemplateImage,
} from '@/lib/birthday-mail';

export const runtime = 'nodejs';

function parseYear(raw: string | null): number {
  const y = Number(raw);
  if (!Number.isInteger(y) || y < BIRTHDAY_MAIL_YEAR_MIN || y > BIRTHDAY_MAIL_YEAR_MAX) {
    throw errors.badRequest('年 (year) が不正です');
  }
  return y;
}

export const GET = handle(async (req: Request) => {
  await requireSuperAdminView();
  const url = new URL(req.url);
  const year = parseYear(url.searchParams.get('year'));
  const template = await getBirthdayTemplate(year);
  return NextResponse.json({ template });
});

export const PUT = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const parsed = BirthdayMailTemplateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }
  const { year, subject, body, enabled } = parsed.data;
  const template = await upsertBirthdayTemplate({ year, subject, body, enabled });

  await logAudit({
    userId: session.user.id,
    action: 'birthday.template_update',
    resource: `birthday-template:${year}`,
    metadata: { year, enabled },
  });

  return NextResponse.json({ ok: true, template });
});

export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();

  const form = await req.formData().catch(() => null);
  if (!form) throw errors.badRequest('multipart/form-data で送信してください');

  const year = parseYear(typeof form.get('year') === 'string' ? (form.get('year') as string) : null);

  // 画像を差し込む前にテンプレートが存在している必要がある。
  const existing = await getBirthdayTemplate(year);
  if (!existing) {
    throw errors.badRequest('先にテンプレート (件名・本文) を保存してください');
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
  if (file.size === 0) throw errors.badRequest('空のファイルです');

  const bytes = Buffer.from(await file.arrayBuffer());
  const fileName = typeof file.name === 'string' && file.name.trim() !== '' ? file.name : null;

  const template = await saveBirthdayTemplateImage({
    year,
    bytes,
    contentType: file.type,
    ext,
    fileName,
  });

  await logAudit({
    userId: session.user.id,
    action: 'birthday.template_image_upload',
    resource: `birthday-template:${year}`,
    metadata: { year, size: file.size, contentType: file.type },
  });

  return NextResponse.json({ ok: true, template }, { status: 201 });
});

export const DELETE = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const url = new URL(req.url);
  const year = parseYear(url.searchParams.get('year'));

  await clearBirthdayTemplateImage(year);

  await logAudit({
    userId: session.user.id,
    action: 'birthday.template_image_delete',
    resource: `birthday-template:${year}`,
    metadata: { year },
  });

  return NextResponse.json({ ok: true });
});
