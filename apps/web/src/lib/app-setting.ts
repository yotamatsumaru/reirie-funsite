/**
 * 永続アプリ設定 (AppSetting) の読み書きヘルパ。
 *  - value は JSON 文字列で保存される。
 *  - 現状はポイント付与レート (points.rates) を保持する。
 *  - 本番 (RDS) で永続し、PM2 cluster の全プロセスが同じ値を参照する。
 */
import { prisma } from '@idol/db';
import {
  DEFAULT_POINT_RATES,
  POINT_RATES_SETTING_KEY,
  PointRateSettingsSchema,
  type PointRateSettings,
  ACCHI_WIN_SETTINGS_KEY,
  DEFAULT_ACCHI_WIN_SETTINGS,
  AcchiWinSettingsByPlanSchema,
  type AcchiWinSettingsByPlan,
  MEMBER_RANK_TIERS_KEY,
  DEFAULT_MEMBER_RANK_TIERS,
  MemberRankTiersSchema,
  normalizeMemberRankTiers,
  type MemberRankTiers,
  ACCHI_REWARD_BONUS_SETTINGS_KEY,
  DEFAULT_ACCHI_REWARD_BONUS_SETTINGS,
  AcchiRewardBonusSettingsSchema,
  type AcchiRewardBonusSettings,
} from '@idol/shared';

/**
 * ポイント付与レートを取得する。
 * 未設定 / 破損時はデフォルト値を返す (安全側)。
 */
export async function getPointRates(): Promise<PointRateSettings> {
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: POINT_RATES_SETTING_KEY },
    });
    if (!row) return DEFAULT_POINT_RATES;
    const parsed = PointRateSettingsSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : DEFAULT_POINT_RATES;
  } catch {
    return DEFAULT_POINT_RATES;
  }
}

/** ポイント付与レートを保存する (バリデーション済みの値を渡すこと) */
export async function setPointRates(rates: PointRateSettings): Promise<PointRateSettings> {
  const value = JSON.stringify(PointRateSettingsSchema.parse(rates));
  await prisma.appSetting.upsert({
    where: { key: POINT_RATES_SETTING_KEY },
    create: { key: POINT_RATES_SETTING_KEY, value },
    update: { value },
  });
  return rates;
}

/**
 * あっち向いてホイのプラン別「設定」(1〜6) を取得する。
 * 未設定 / 破損時は既定値を返す (安全側)。
 */
export async function getAcchiWinSettings(): Promise<AcchiWinSettingsByPlan> {
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: ACCHI_WIN_SETTINGS_KEY },
    });
    if (!row) return DEFAULT_ACCHI_WIN_SETTINGS;
    const parsed = AcchiWinSettingsByPlanSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : DEFAULT_ACCHI_WIN_SETTINGS;
  } catch {
    return DEFAULT_ACCHI_WIN_SETTINGS;
  }
}

/** あっち向いてホイのプラン別「設定」を保存する */
export async function setAcchiWinSettings(
  settings: AcchiWinSettingsByPlan,
): Promise<AcchiWinSettingsByPlan> {
  const validated = AcchiWinSettingsByPlanSchema.parse(settings);
  const value = JSON.stringify(validated);
  await prisma.appSetting.upsert({
    where: { key: ACCHI_WIN_SETTINGS_KEY },
    create: { key: ACCHI_WIN_SETTINGS_KEY, value },
    update: { value },
  });
  return validated;
}

/**
 * あっち向いてホイの勝利特典ポイント設定 (1勝あたりの付与量 / 1日上限) を取得する。
 * 未設定 / 破損時は既定値 (1勝=1pt, 1日上限3pt) を返す (安全側)。
 */
export async function getAcchiRewardBonusSettings(): Promise<AcchiRewardBonusSettings> {
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: ACCHI_REWARD_BONUS_SETTINGS_KEY },
    });
    if (!row) return DEFAULT_ACCHI_REWARD_BONUS_SETTINGS;
    const parsed = AcchiRewardBonusSettingsSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : DEFAULT_ACCHI_REWARD_BONUS_SETTINGS;
  } catch {
    return DEFAULT_ACCHI_REWARD_BONUS_SETTINGS;
  }
}

/** あっち向いてホイの勝利特典ポイント設定を保存する */
export async function setAcchiRewardBonusSettings(
  settings: AcchiRewardBonusSettings,
): Promise<AcchiRewardBonusSettings> {
  const validated = AcchiRewardBonusSettingsSchema.parse(settings);
  const value = JSON.stringify(validated);
  await prisma.appSetting.upsert({
    where: { key: ACCHI_REWARD_BONUS_SETTINGS_KEY },
    create: { key: ACCHI_REWARD_BONUS_SETTINGS_KEY, value },
    update: { value },
  });
  return validated;
}

/**
 * 会員ランクの昇格条件 (しきい値) を取得する。
 * 未設定 / 破損時は既定値を返す (安全側)。欠落ランクは既定で補完する。
 */
export async function getMemberRankTiers(): Promise<MemberRankTiers> {
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: MEMBER_RANK_TIERS_KEY },
    });
    if (!row) return DEFAULT_MEMBER_RANK_TIERS;
    const parsed = MemberRankTiersSchema.safeParse(JSON.parse(row.value));
    return parsed.success
      ? normalizeMemberRankTiers(parsed.data)
      : DEFAULT_MEMBER_RANK_TIERS;
  } catch {
    return DEFAULT_MEMBER_RANK_TIERS;
  }
}

/** 会員ランクの昇格条件を保存する (BRONZE は 0/0 に正規化される) */
export async function setMemberRankTiers(
  tiers: MemberRankTiers,
): Promise<MemberRankTiers> {
  const validated = MemberRankTiersSchema.parse(normalizeMemberRankTiers(tiers));
  const value = JSON.stringify(validated);
  await prisma.appSetting.upsert({
    where: { key: MEMBER_RANK_TIERS_KEY },
    create: { key: MEMBER_RANK_TIERS_KEY, value },
    update: { value },
  });
  return validated;
}
