/**
 * GET   /api/super-admin/slot-settings — スロットのプラン別「設定」(1〜6) を取得
 * PATCH /api/super-admin/slot-settings — プラン別「設定」を更新 (永続化)
 *
 * SUPER_ADMIN 限定。値は AppSetting (slot.settings) に JSON で永続化される。
 * 設定値が大きいほど当たりやすい (パチスロ風 設定 1〜6)。
 */
import { NextResponse } from 'next/server';
import { SlotSettingsByPlanSchema } from '@idol/shared';
import { requireSuperAdmin, requireSuperAdminView } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getSlotSettings, setSlotSettings } from '@/lib/app-setting';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireSuperAdminView();
  const settings = await getSlotSettings();
  return NextResponse.json({ settings });
});

export const PATCH = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const parsed = SlotSettingsByPlanSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です (設定は 1〜6 で指定してください)');
  }

  const prev = await getSlotSettings();
  const next = await setSlotSettings(parsed.data);

  await logAudit({
    userId: session.user.id,
    action: 'setting.slot_settings_update',
    resource: 'setting:slot.settings',
    metadata: { from: prev, to: next },
  });

  return NextResponse.json({ ok: true, settings: next });
});
