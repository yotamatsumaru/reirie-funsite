/**
 * GET   /api/super-admin/site-visibility — コンテンツ/グッズ/DM セクションの公開設定を取得
 * PATCH /api/super-admin/site-visibility — 公開設定を更新 (即時反映)
 *
 * SUPER_ADMIN 限定。値は AppSetting (site.sectionVisibility) に永続化される。
 * 非公開にすると /contents, /products, /me/dm (および各詳細ページ・公開API) が
 * 404 相当になる (/admin/*, /super-admin/* の管理画面は対象外)。
 */
import { NextResponse } from 'next/server';
import { SiteSectionVisibilitySchema } from '@idol/shared';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getSiteSectionVisibility, setSiteSectionVisibility } from '@/lib/app-setting';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireSuperAdmin();
  const visibility = await getSiteSectionVisibility();
  return NextResponse.json({ visibility });
});

const PatchSchema = SiteSectionVisibilitySchema.partial();

export const PATCH = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です');
  }

  const prev = await getSiteSectionVisibility();
  const next = await setSiteSectionVisibility({ ...prev, ...parsed.data });

  await logAudit({
    userId: session.user.id,
    action: 'setting.site_visibility_update',
    resource: 'setting:site.sectionVisibility',
    metadata: { from: prev, to: next },
  });

  return NextResponse.json({ visibility: next });
});
