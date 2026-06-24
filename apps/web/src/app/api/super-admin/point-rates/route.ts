/**
 * GET   /api/super-admin/point-rates — 現在のポイント付与レートを取得
 * PATCH /api/super-admin/point-rates — ポイント付与レートを更新 (永続化)
 *
 * SUPER_ADMIN 限定。値は AppSetting (points.rates) に JSON で永続化される。
 */
import { NextResponse } from 'next/server';
import { PointRateSettingsSchema } from '@idol/shared';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getPointRates, setPointRates } from '@/lib/app-setting';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireSuperAdmin();
  const rates = await getPointRates();
  return NextResponse.json({ rates });
});

export const PATCH = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const parsed = PointRateSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }

  const prev = await getPointRates();
  const next = await setPointRates(parsed.data);

  await logAudit({
    userId: session.user.id,
    action: 'setting.point_rates_update',
    resource: 'setting:points.rates',
    metadata: { from: prev, to: next },
  });

  return NextResponse.json({ ok: true, rates: next });
});
