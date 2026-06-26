/**
 * GET   /api/super-admin/acchi-settings — あっち向いてホイのプラン別「設定」(1〜6) を取得
 * PATCH /api/super-admin/acchi-settings — プラン別「設定」を更新 (永続化)
 *
 * SUPER_ADMIN 限定。値は AppSetting (acchi.winSettings) に JSON で永続化される。
 * 設定値が大きいほどプレイヤーが勝ちやすい (パチンコ風 設定 1〜6)。
 */
import { NextResponse } from 'next/server';
import { AcchiWinSettingsByPlanSchema } from '@idol/shared';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getAcchiWinSettings, setAcchiWinSettings } from '@/lib/app-setting';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireSuperAdmin();
  const settings = await getAcchiWinSettings();
  return NextResponse.json({ settings });
});

export const PATCH = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const parsed = AcchiWinSettingsByPlanSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です (設定は 1〜6 で指定してください)');
  }

  const prev = await getAcchiWinSettings();
  const next = await setAcchiWinSettings(parsed.data);

  await logAudit({
    userId: session.user.id,
    action: 'setting.acchi_win_settings_update',
    resource: 'setting:acchi.winSettings',
    metadata: { from: prev, to: next },
  });

  return NextResponse.json({ ok: true, settings: next });
});
