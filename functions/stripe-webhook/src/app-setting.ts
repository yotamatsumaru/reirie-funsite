/**
 * AppSetting (DB) から Stripe の運用モード / テスト資格情報を読み取るヘルパー。
 *
 * Web アプリ (apps/web/src/lib/app-setting.ts) と同じ AppSetting キー
 * (stripe.mode / stripe.testCredentials) を、独立 Lambda 側でも読めるようにする。
 * これにより管理画面のトグル 1 つで Web アプリと Lambda の両方が
 * 本番 / テストを一括で切り替えられる (A-1 方式)。
 *
 * 破損・未設定時は必ず「安全側」の LIVE 相当を返し、フェイルセーフ性を維持する。
 */
import {
  DEFAULT_STRIPE_MODE,
  DEFAULT_STRIPE_TEST_CREDENTIALS,
  STRIPE_MODE_SETTING_KEY,
  STRIPE_TEST_CREDENTIALS_SETTING_KEY,
  StripeModeSchema,
  StripeTestCredentialsSchema,
  type StripeMode,
  type StripeTestCredentials,
} from '@idol/shared';
import { prisma } from './db';

/**
 * 現在の Stripe 運用モード (LIVE / TEST) を DB から取得する。
 * 未設定 / 破損 / DB エラー時は LIVE (安全側) を返す。
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

/**
 * テストモード用の Stripe 資格情報を DB から取得する。
 * 未設定 / 破損 / DB エラー時は空の既定値を返す。
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
