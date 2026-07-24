/**
 * GET   /api/super-admin/maintenance — メンテナンスモード設定を取得
 * PATCH /api/super-admin/maintenance — メンテナンスモード設定を更新 (即時反映)
 *
 * SUPER_ADMIN 限定。値は AppSetting (site.maintenance) に永続化される。
 * enabled=true にすると、SUPER_ADMIN 以外のすべての訪問者は middleware によって
 * /maintenance にリダイレクト (API は 503) され、サイトを閲覧できなくなる。
 */
import { NextResponse } from 'next/server';
import { MaintenanceSettingSchema } from '@idol/shared';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getMaintenanceSetting, setMaintenanceSetting } from '@/lib/app-setting';
import { primeMaintenanceCache } from '@/lib/maintenance-flag';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireSuperAdmin();
  const setting = await getMaintenanceSetting();
  return NextResponse.json({ setting });
});

const PatchSchema = MaintenanceSettingSchema.partial();

export const PATCH = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です');
  }

  const { before, after } = await setMaintenanceSetting(parsed.data);

  // proxy.ts のキャッシュを即時更新し、切り替えを待ち時間なく反映させる。
  primeMaintenanceCache(after.enabled);

  await logAudit({
    userId: session.user.id,
    action: 'setting.maintenance_update',
    resource: 'setting:site.maintenance',
    metadata: { from: before, to: after },
  });

  return NextResponse.json({ setting: after });
});
