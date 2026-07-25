/**
 * GET   /api/super-admin/point-rates — 現在の Pui 付与レートを取得
 * PATCH /api/super-admin/point-rates — Pui 付与レートを更新 (永続化)
 *
 * SUPER_ADMIN 限定。値は AppSetting (pui.rates) に JSON で永続化される。
 * 【2026-07 通貨名変更】URL 自体 (point-rates) は後方互換のため変更していない。
 */
import { NextResponse } from 'next/server';
import { PuiRateSettingsSchema } from '@idol/shared';
import { requireSuperAdmin, requireSuperAdminView } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getPuiRates, setPuiRates } from '@/lib/app-setting';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireSuperAdminView();
  const rates = await getPuiRates();
  return NextResponse.json({ rates });
});

export const PATCH = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const parsed = PuiRateSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }

  const prev = await getPuiRates();
  const next = await setPuiRates(parsed.data);

  await logAudit({
    userId: session.user.id,
    action: 'setting.pui_rates_update',
    resource: 'setting:pui.rates',
    metadata: { from: prev, to: next },
  });

  return NextResponse.json({ ok: true, rates: next });
});
