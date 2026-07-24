/**
 * Stripe 本番/テストモード切り替え設定。
 *
 * - 管理画面 (SUPER_ADMIN) からトグルで即時切り替え。サーバ再起動不要。
 * - 本番用キー (STRIPE_SECRET_KEY 等) は .env.production から変更なしで読み込み、
 *   テストモード用キーは AppSetting (stripe.testCredentials) に暗号化せず保存する
 *   (テストキーは Stripe Dashboard の Test mode 専用で実害が小さいため)。
 * - 「有効モード」自体は AppSetting (stripe.mode) に 'LIVE' | 'TEST' の文字列で永続化。
 *
 * 対象:
 *  - Web アプリ (apps/web) の Checkout / Portal / Webhook
 *  - 独立稼働の Stripe Webhook Lambda (functions/stripe-webhook)
 *    ※ 以前は本番キー固定 (対象外) だったが、テストモードでもプラン/ランクを
 *      検証できるよう、Lambda も stripe.mode / stripe.testCredentials を読んで
 *      本番/テストを切り替えるようにした (A-1 方式)。テスト資格情報が未設定なら
 *      安全側で本番 (LIVE) にフォールバックし、フェイルセーフ性を維持する。
 */
import { z } from 'zod';

export const STRIPE_MODES = ['LIVE', 'TEST'] as const;
export type StripeMode = (typeof STRIPE_MODES)[number];

export const STRIPE_MODE_LABELS: Record<StripeMode, string> = {
  LIVE: '本番 (Live)',
  TEST: 'テスト (Test)',
};

/** AppSetting に保存する「現在のモード」のキー */
export const STRIPE_MODE_SETTING_KEY = 'stripe.mode';

/** AppSetting に保存する「テストモード用 Stripe 資格情報」のキー */
export const STRIPE_TEST_CREDENTIALS_SETTING_KEY = 'stripe.testCredentials';

export const DEFAULT_STRIPE_MODE: StripeMode = 'LIVE';

export const StripeModeSchema = z.enum(STRIPE_MODES);

/**
 * テストモード用の Stripe 資格情報。
 * 未入力のフィールドは空文字のまま保存を許容する (段階的に設定できるようにするため)。
 * ただし実際にテストモードへ切り替える際は secretKey / webhookSecret は必須にする。
 */
// 貼り付け時の前後空白・改行が原因で「必須項目が未設定」と誤判定されるのを防ぐため、
// 保存前に各値を trim する。空文字は許容 (段階的に設定できるようにするため)。
const trimmedString = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => v.trim())
    .default('');

export const StripeTestCredentialsSchema = z.object({
  secretKey: trimmedString(500),
  publishableKey: trimmedString(500),
  webhookSecret: trimmedString(500),
  priceStandardMonthly: trimmedString(200),
  priceStandardYearly: trimmedString(200),
  pricePremiumMonthly: trimmedString(200),
  pricePremiumYearly: trimmedString(200),
});

export type StripeTestCredentials = z.infer<typeof StripeTestCredentialsSchema>;

export const DEFAULT_STRIPE_TEST_CREDENTIALS: StripeTestCredentials = {
  secretKey: '',
  publishableKey: '',
  webhookSecret: '',
  priceStandardMonthly: '',
  priceStandardYearly: '',
  pricePremiumMonthly: '',
  pricePremiumYearly: '',
};

/**
 * テストモードを実際に有効化できる状態か (必須項目が揃っているか) を判定する。
 * secretKey と webhookSecret が両方入力されていれば ON にできる。
 */
export function isStripeTestCredentialsUsable(c: StripeTestCredentials): boolean {
  return c.secretKey.trim() !== '' && c.webhookSecret.trim() !== '';
}

/** Stripe の Secret Key が sk_test_ / rk_test_ で始まるかどうか (簡易バリデーション用) */
export function looksLikeTestSecretKey(key: string): boolean {
  return /^(sk|rk)_test_/.test(key.trim());
}

/** Stripe の Secret Key が sk_live_ / rk_live_ で始まるかどうか (簡易バリデーション用) */
export function looksLikeLiveSecretKey(key: string): boolean {
  return /^(sk|rk)_live_/.test(key.trim());
}
