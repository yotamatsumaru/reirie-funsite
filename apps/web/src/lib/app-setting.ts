/**
 * 永続アプリ設定 (AppSetting) の読み書きヘルパ。
 *  - value は JSON 文字列で保存される。
 *  - 現状は Pui 付与レート (pui.rates) を保持する。
 *  - 本番 (RDS) で永続し、PM2 cluster の全プロセスが同じ値を参照する。
 */
import { prisma, Prisma } from '@idol/db';
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
  MAINTENANCE_SETTING_KEY,
  DEFAULT_MAINTENANCE_SETTING,
  MaintenanceSettingSchema,
  type MaintenanceSetting,
  SHARE_TEMPLATE_SETTING_KEY,
  DEFAULT_SHARE_TEMPLATES,
  ShareTemplateSettingsSchema,
  type ShareTemplateSettings,
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
 * SNS シェアのテンプレート文 (X / Instagram) を取得する。
 * 未設定 / 破損時は既定値を返す (安全側)。欠損フィールドは既定値で補完する。
 */
export async function getShareTemplates(): Promise<ShareTemplateSettings> {
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: SHARE_TEMPLATE_SETTING_KEY },
    });
    if (!row) return DEFAULT_SHARE_TEMPLATES;
    // 欠損フィールドは既定値で補完してからパースする (部分保存 / 旧バージョン対策)。
    const raw = JSON.parse(row.value) as Record<string, unknown>;
    const parsed = ShareTemplateSettingsSchema.safeParse({
      ...DEFAULT_SHARE_TEMPLATES,
      ...raw,
    });
    return parsed.success ? parsed.data : DEFAULT_SHARE_TEMPLATES;
  } catch {
    return DEFAULT_SHARE_TEMPLATES;
  }
}

/** SNS シェアのテンプレート文を保存する (SUPER_ADMIN 限定で呼び出すこと) */
export async function setShareTemplates(
  templates: ShareTemplateSettings,
): Promise<ShareTemplateSettings> {
  const validated = ShareTemplateSettingsSchema.parse(templates);
  const value = JSON.stringify(validated);
  await prisma.appSetting.upsert({
    where: { key: SHARE_TEMPLATE_SETTING_KEY },
    create: { key: SHARE_TEMPLATE_SETTING_KEY, value },
    update: { value },
  });
  return validated;
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
    // 旧バージョンで一部フィールドが欠けた行が保存されている可能性に備え、
    // まず既定値とマージしてからパースする (欠損フィールドのみ既定値で補完)。
    const raw = JSON.parse(row.value) as Record<string, unknown>;
    const parsed = SiteSectionVisibilitySchema.safeParse({
      ...DEFAULT_SITE_SECTION_VISIBILITY,
      ...raw,
    });
    return parsed.success ? parsed.data : DEFAULT_SITE_SECTION_VISIBILITY;
  } catch {
    return DEFAULT_SITE_SECTION_VISIBILITY;
  }
}

/**
 * サイト全体のメンテナンスモード設定を取得する。
 * 未設定 / 破損時は既定値 (通常運用 = メンテナンス OFF) を返す (安全側)。
 *
 * 【注意】この関数は Node ランタイム (Prisma) 依存のため、Edge middleware からは
 * 直接呼べない。middleware は /api/maintenance-status 経由で状態を取得する
 * (middleware.ts のコメント参照)。
 */
export async function getMaintenanceSetting(): Promise<MaintenanceSetting> {
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: MAINTENANCE_SETTING_KEY },
    });
    if (!row) return DEFAULT_MAINTENANCE_SETTING;
    // 欠損フィールドは既定値で補完してからパースする (部分保存対策)。
    const raw = JSON.parse(row.value) as Record<string, unknown>;
    const parsed = MaintenanceSettingSchema.safeParse({
      ...DEFAULT_MAINTENANCE_SETTING,
      ...raw,
    });
    return parsed.success ? parsed.data : DEFAULT_MAINTENANCE_SETTING;
  } catch {
    return DEFAULT_MAINTENANCE_SETTING;
  }
}

/**
 * メンテナンスモード設定を「部分更新」する (SUPER_ADMIN 限定で呼び出すこと)。
 * site-visibility と同じく advisory lock で read → merge → write を直列化し、
 * 連続操作による更新取りこぼしを防ぐ。
 */
export async function setMaintenanceSetting(
  patch: Partial<MaintenanceSetting>,
): Promise<{ before: MaintenanceSetting; after: MaintenanceSetting }> {
  return prisma.$transaction(async (tx) => {
    await acquireAppSettingLock(tx, MAINTENANCE_SETTING_KEY);

    const row = await tx.appSetting.findUnique({
      where: { key: MAINTENANCE_SETTING_KEY },
    });
    let before: MaintenanceSetting = DEFAULT_MAINTENANCE_SETTING;
    if (row) {
      try {
        // 欠損フィールドは既定値で補完してから読み込む (部分保存対策)。
        const raw = JSON.parse(row.value) as Record<string, unknown>;
        const parsed = MaintenanceSettingSchema.safeParse({
          ...DEFAULT_MAINTENANCE_SETTING,
          ...raw,
        });
        if (parsed.success) before = parsed.data;
      } catch {
        // 破損データはデフォルト値扱い (安全側)
      }
    }

    // patch には「変更されたフィールドのみ」が含まれる。before に重ねて他は維持する。
    const after = MaintenanceSettingSchema.parse({ ...before, ...patch });
    const value = JSON.stringify(after);
    await tx.appSetting.upsert({
      where: { key: MAINTENANCE_SETTING_KEY },
      create: { key: MAINTENANCE_SETTING_KEY, value },
      update: { value },
    });
    return { before, after };
  });
}

/**
 * 任意の文字列を符号付き 32bit 整数 (PostgreSQL int4 の範囲) に決定論的に変換する。
 * advisory lock のキー用。points.ts の hashStringToInt32 と同一の FNV-1a アルゴリズム。
 * (AppSetting 用に独立して持つことで、points.ts への依存を作らないようにしている。)
 */
function hashKeyToInt32(input: string): number {
  let hash = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) | 0;
}

/**
 * AppSetting の指定キーに対する更新を直列化するための
 * トランザクションスコープ advisory lock を取得する。
 *
 * なぜ必要か:
 *  - AppSetting の各種 set 系関数は「read → JS 上でマージ → write」という
 *    Read-Modify-Write を行うが、ロックなしだと PostgreSQL の既定分離レベル
 *    (READ COMMITTED) 下で、同一キーに対するほぼ同時の 2 リクエスト
 *    (例: 管理画面のトグルを連続でクリック) が両方とも「更新前」の同じ行を読み、
 *    片方の変更がもう片方の書き込みで上書き・消失する (lost update)。
 *  - 例: サイト公開設定でコンテンツを OFF にした直後に DM を ON にすると、
 *    2 つの PATCH リクエストが競合し、DM の ON だけが保存されて
 *    コンテンツの OFF が消えてしまう、という不具合が実際に発生した。
 *
 * 対策:
 *  - pg_advisory_xact_lock(key1, key2) を使い、(固定の namespace, 設定キー) を
 *    キーにトランザクションを直列化する。ロックはトランザクション終了時
 *    (COMMIT/ROLLBACK) に自動解放されるため、明示的な解放漏れが起きない。
 *  - advisory lock は DB (RDS) 全体で有効なので、PM2 cluster の複数プロセス間でも
 *    確実に排他できる (points.ts の acquireUserGameLock と同じ手法)。
 *
 * @param tx        トランザクションクライアント (必ず $transaction 内で呼ぶこと)
 * @param settingKey ロック対象の AppSetting.key (例: 'site.sectionVisibility')
 */
async function acquireAppSettingLock(
  tx: Prisma.TransactionClient,
  settingKey: string,
): Promise<void> {
  const key1 = hashKeyToInt32('app_setting');
  const key2 = hashKeyToInt32(settingKey);
  // int8 バインド値を pg_advisory_xact_lock(int4, int4) の範囲に安全に収める
  // (points.ts の acquireUserGameLock と同じキャスト方式。詳細はそちら参照)。
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      (((${key1}::bigint & 4294967295) + 2147483648) % 4294967296 - 2147483648)::int,
      (((${key2}::bigint & 4294967295) + 2147483648) % 4294967296 - 2147483648)::int
    )`;
}

/**
 * コンテンツ / グッズ / DM セクションのサイト全体公開設定を「部分更新」する
 * (SUPER_ADMIN 限定で呼び出すこと)。
 *
 * 【重要 / 競合対策】渡された patch のみを対象キーで読み直した最新値にマージし、
 * advisory lock で直列化した 1 つのトランザクション内で read → merge → write を
 * 行う。これにより、ほぼ同時に届いた複数の PATCH リクエスト (トグルの連打等) でも
 * 更新の取りこぼしが起きない (詳細は acquireAppSettingLock のコメント参照)。
 *
 * @param patch 変更したいフィールドのみを含む部分オブジェクト
 * @returns 更新前 (before) と更新後 (after) の完全な設定値
 */
export async function setSiteSectionVisibility(
  patch: Partial<SiteSectionVisibility>,
): Promise<{ before: SiteSectionVisibility; after: SiteSectionVisibility }> {
  return prisma.$transaction(async (tx) => {
    await acquireAppSettingLock(tx, SITE_SECTION_VISIBILITY_KEY);

    const row = await tx.appSetting.findUnique({
      where: { key: SITE_SECTION_VISIBILITY_KEY },
    });
    let before: SiteSectionVisibility = DEFAULT_SITE_SECTION_VISIBILITY;
    if (row) {
      try {
        // 欠損フィールドは既定値で補完してから読み込む (前バージョンの部分保存対策)。
        const raw = JSON.parse(row.value) as Record<string, unknown>;
        const parsed = SiteSectionVisibilitySchema.safeParse({
          ...DEFAULT_SITE_SECTION_VISIBILITY,
          ...raw,
        });
        if (parsed.success) before = parsed.data;
      } catch {
        // 破損データはデフォルト値扱い (安全側)
      }
    }

    // patch には「変更されたフィールドのみ」が含まれる (undefined は除去済み)。
    // before に patch を重ねることで、他のフィールドは保存済みの値を維持する。
    const after = SiteSectionVisibilitySchema.parse({ ...before, ...patch });
    const value = JSON.stringify(after);
    await tx.appSetting.upsert({
      where: { key: SITE_SECTION_VISIBILITY_KEY },
      create: { key: SITE_SECTION_VISIBILITY_KEY, value },
      update: { value },
    });
    return { before, after };
  });
}
