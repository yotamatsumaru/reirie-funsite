/**
 * GET   /api/super-admin/share-templates — 現在の SNS シェアテンプレート文を取得
 * PATCH /api/super-admin/share-templates — SNS シェアテンプレート文を更新 (永続化)
 *
 * SUPER_ADMIN 限定。値は AppSetting (share.templates) に JSON で永続化される。
 * シェア対象は X のみ (Instagram は 2026-07 に廃止)。URL はシェア時に自動付与
 * されるため、本文に URL を含める必要はない。
 */
import { NextResponse } from 'next/server';
import { ShareTemplateSettingsSchema } from '@idol/shared';
import { requireSuperAdmin, requireSuperAdminView } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getShareTemplates, setShareTemplates } from '@/lib/app-setting';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireSuperAdminView();
  const templates = await getShareTemplates();
  return NextResponse.json({ templates });
});

export const PATCH = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const parsed = ShareTemplateSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }

  const prev = await getShareTemplates();
  const next = await setShareTemplates(parsed.data);

  await logAudit({
    userId: session.user.id,
    action: 'setting.share_templates_update',
    resource: 'setting:share.templates',
    metadata: { from: prev, to: next },
  });

  return NextResponse.json({ ok: true, templates: next });
});
