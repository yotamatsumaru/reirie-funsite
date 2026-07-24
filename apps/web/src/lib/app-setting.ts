/**
 * 永続アプリ設定 (AppSetting) の読み書きヘルパ。
 *  - value は JSON 文字列で保存される。
 *  - 現状は Pui 付与レート (pui.rates) を保持する。
 *  - 本番 (RDS) で永続し、PM2 cluster の全プロセスが同じ値を参照する。
 */
import { prisma } from '@idol/db';
import {
  DEFAULT_PUI_RATES,
  PUI_RATES_SETTING_KEY,
  PuiRateSettingsSchema,
  type PuiRateSettings,
  ACCHI_WIN_SETTINGS_KEY,
  DEFAULT_ACCHI_WIN_SETTINGS,
  AcchiWinSettingsByPlanSchema,
  type AcchiWinSettingsByPlan,
  MEMBER_RANK_TIERS_KEY,
  DEFAULT_MEMBER_RANK_TIERS,
  MemberRankTiersSchema,
  normalizeMemberRankTiers,
  type MemberRankTiers,
  STRIPE_MODE_SETTING_KEY,
  DEFAULT_STRIPE_MODE,
  StripeModeSchema,
  type StripeMode,
  STRIPE_TEST_CREDENTIALS_SETTING_KEY,
  DEFAULT_STRIPE_TEST_CREDENTIALS,
  StripeTestCredentialsSchema,
  type StripeTestCredentials,
  SITE_SECTION_VISIBILITY_KEY,
  DEFAULT_SITE_SECTION_VISIBILITY,
  SiteSectionVisibilitySchema,
  type SiteSectionVisibility,
} from '@idol/shared';

/**
 * Pui 付与レートを取得する。
 * 未設定 / 破損時はデフォルト値を返す (安全側)。
 * 【2026-07 通貨名変更】設定キーは旧 'points.rates' から 'pui.rates' に変更した。
 * 旧キーで保存された既存行からのフォールバック読み込みにも対応する。
 */
export async function getPuiRates(): Promise<PuiRateSettings> {
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: PUI_RATES_SETTING_KEY },
    });
    if (row) {
      const parsed = PuiRateSettingsSchema.safeParse(JSON.parse(row.value));
      if (parsed.success) return parsed.data;
    } else {
      // 旧キー ('points.rates') に残っている可能性のある設定を読み込む (移行未実施環境向け)。
      const legacyRow = await prisma.appSetting.findUnique({
        where: { key: 'points.rates' },
      });
      if (legacyRow) {
        const parsedLegacy = PuiRateSettingsSchema.safeParse(JSON.parse(legacyRow.value));
        if (parsedLegacy.success) return parsedLegacy.data;
      }
    }
    return DEFAULT_PUI_RATES;
  } catch {
    return DEFAULT_PUI_RATES;
  }
}

/** Pui 付与レートを保存する (バリデーション済みの値を渡すこと) */
export async function setPuiRates(rates: PuiRateSettings): Promise<PuiRateSettings> {
  const value = JSON.stringify(PuiRateSettingsSchema.parse(rates));
  await prisma.appSetting.upsert({
    where: { key: PUI_RATES_SETTING_KEY },
    create: { key: PUI_RATES_SETTING_KEY, value },
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

/**
 * Stripe の現在の運用モード (LIVE / TEST) を取得する。
 * 未設定 / 破損時は LIVE (安全側) を返す。
 */
export async function getStripeMode(): Promise<StripeMode> {
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: STRIPE_MODE_SETTING_KEY },
    });
    if (!row) return DEFAULT_STRIPE_MODE;
    const parsed = StripeModeSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : DEFAULT_STRIPE_MODE;
  } catch {
    return DEFAULT_STRIPE_MODE;
  }
}

/** Stripe の運用モードを保存する (SUPER_ADMIN 限定で呼び出すこと) */
export async function setStripeMode(mode: StripeMode): Promise<StripeMode> {
  const validated = StripeModeSchema.parse(mode);
  const value = JSON.stringify(validated);
  await prisma.appSetting.upsert({
    where: { key: STRIPE_MODE_SETTING_KEY },
    create: { key: STRIPE_MODE_SETTING_KEY, value },
    update: { value },
  });
  return validated;
}

/**
 * テストモード用の Stripe 資格情報 (Secret Key / Webhook Secret / Price ID 等) を取得する。
 * 未設定 / 破損時は空文字の既定値を返す。
 */
export async function getStripeTestCredentials(): Promise<StripeTestCredentials> {
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: STRIPE_TEST_CREDENTIALS_SETTING_KEY },
    });
    if (!row) return DEFAULT_STRIPE_TEST_CREDENTIALS;
    const parsed = StripeTestCredentialsSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : DEFAULT_STRIPE_TEST_CREDENTIALS;
  } catch {
    return DEFAULT_STRIPE_TEST_CREDENTIALS;
  }
}

/** テストモード用の Stripe 資格情報を保存する (SUPER_ADMIN 限定で呼び出すこと) */
export async function setStripeTestCredentials(
  creds: StripeTestCredentials,
): Promise<StripeTestCredentials> {
  const validated = StripeTestCredentialsSchema.parse(creds);
  const value = JSON.stringify(validated);
  await prisma.appSetting.upsert({
    where: { key: STRIPE_TEST_CREDENTIALS_SETTING_KEY },
    create: { key: STRIPE_TEST_CREDENTIALS_SETTING_KEY, value },
    update: { value },
  });
  return validated;
}

/**
 * コンテンツ / グッズ セクションのサイト全体公開設定を取得する。
 * 未設定 / 破損時は既定値 (両方公開) を返す (安全側)。
 */
export async function getSiteSectionVisibility(): Promise<SiteSectionVisibility> {
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: SITE_SECTION_VISIBILITY_KEY },
    });
    if (!row) return DEFAULT_SITE_SECTION_VISIBILITY;
    const parsed = SiteSectionVisibilitySchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : DEFAULT_SITE_SECTION_VISIBILITY;
  } catch {
    return DEFAULT_SITE_SECTION_VISIBILITY;
  }
}

/** コンテンツ / グッズ セクションのサイト全体公開設定を保存する (SUPER_ADMIN 限定で呼び出すこと) */
export async function setSiteSectionVisibility(
  visibility: SiteSectionVisibility,
): Promise<SiteSectionVisibility> {
  const validated = SiteSectionVisibilitySchema.parse(visibility);
  const value = JSON.stringify(validated);
  await prisma.appSetting.upsert({
    where: { key: SITE_SECTION_VISIBILITY_KEY },
    create: { key: SITE_SECTION_VISIBILITY_KEY, value },
    update: { value },
  });
  return validated;
}
