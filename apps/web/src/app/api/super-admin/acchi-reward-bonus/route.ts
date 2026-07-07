/**
 * GET   /api/super-admin/acchi-reward-bonus — あっち向いてホイの勝利特典ポイント設定を取得
 * PATCH /api/super-admin/acchi-reward-bonus — 勝利特典ポイント設定 (1勝あたりの付与量 / 1日上限) を更新
 *
 * SUPER_ADMIN 限定。値は AppSetting (acchi.rewardBonusSettings) に JSON で永続化される。
 * 「あっち向いてホイ」勝利時、Fan ポイントとは別枠で特典ポイントを少量付与する機能の
 * レート (perWin) と 1日上限 (dailyCap) を管理者が調整できる。
 * dailyCap または perWin を 0 にすると、事実上このボーナス機能を無効化できる。
 */
import { NextResponse } from 'next/server';
import { AcchiRewardBonusSettingsSchema } from '@idol/shared';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import {
  getAcchiRewardBonusSettings,
  setAcchiRewardBonusSettings,
} from '@/lib/app-setting';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireSuperAdmin();
  const settings = await getAcchiRewardBonusSettings();
  return NextResponse.json({ settings });
});

export const PATCH = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const parsed = AcchiRewardBonusSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable(
      '入力値が不正です (1勝あたりの付与量・1日上限は 0 以上の整数で指定してください)',
    );
  }

  const prev = await getAcchiRewardBonusSettings();
  const next = await setAcchiRewardBonusSettings(parsed.data);

  await logAudit({
    userId: session.user.id,
    action: 'setting.acchi_reward_bonus_settings_update',
    resource: 'setting:acchi.rewardBonusSettings',
    metadata: { from: prev, to: next },
  });

  return NextResponse.json({ ok: true, settings: next });
});
