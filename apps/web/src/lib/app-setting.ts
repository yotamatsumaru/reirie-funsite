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
