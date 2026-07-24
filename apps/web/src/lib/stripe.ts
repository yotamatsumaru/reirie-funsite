/**
 * Stripe クライアント (本番 / テストモード切り替え対応)
 *
 * - 通常は .env.production の本番キー (STRIPE_SECRET_KEY 等) を使う。
 * - AppSetting (stripe.mode = 'TEST') が有効な場合は、管理画面で入力した
 *   テストモード用キー (AppSetting: stripe.testCredentials) を使う。
 * - 切り替えは即時反映 (サーバ再起動不要)。DB を読むため async 関数になる。
 * - 対象は Web アプリの Checkout / Portal / Webhook。
 *   独立稼働の Stripe Webhook Lambda (functions/stripe-webhook) も、
 *   同じ AppSetting (stripe.mode / stripe.testCredentials) を読んで
 *   本番/テストを切り替えるようになった (プラン/ランクの反映を担当)。
 *   テスト資格情報が未設定なら Lambda 側も安全側で本番にフォールバックする。
 */
import Stripe from 'stripe';
import { env } from './env';
import { getStripeMode, getStripeTestCredentials } from './app-setting';

type ResolvedStripeConfig = {
  mode: 'LIVE' | 'TEST';
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
  prices: {
    standardMonthly?: string;
    standardYearly?: string;
    premiumMonthly?: string;
    premiumYearly?: string;
  };
};

// モードごとに Stripe クライアントをキャッシュ (モード切り替え時に作り直す)
let _stripeCache: { mode: 'LIVE' | 'TEST'; secretKey: string; client: Stripe } | null = null;

/**
 * 現在有効な Stripe 設定 (モード・キー・Price ID) を解決する。
 * テストモードでも secretKey/webhookSecret が未入力なら安全側で LIVE にフォールバックする。
 */
export async function resolveStripeConfig(): Promise<ResolvedStripeConfig> {
  const mode = await getStripeMode();

  if (mode === 'TEST') {
    const test = await getStripeTestCredentials();
    if (test.secretKey && test.webhookSecret) {
      return {
        mode: 'TEST',
        secretKey: test.secretKey,
        publishableKey: test.publishableKey,
        webhookSecret: test.webhookSecret,
        prices: {
          standardMonthly: test.priceStandardMonthly || undefined,
          standardYearly: test.priceStandardYearly || undefined,
          premiumMonthly: test.pricePremiumMonthly || undefined,
          premiumYearly: test.pricePremiumYearly || undefined,
        },
      };
    }
    // 必須項目が未入力ならテストモードにできないので LIVE にフォールバック
  }

  return {
    mode: 'LIVE',
    secretKey: env.stripe.secretKey,
    publishableKey: env.stripe.publishableKey,
    webhookSecret: env.stripe.webhookSecret,
    prices: env.stripe.prices,
  };
}

/** 現在のモードに応じた Stripe クライアントを取得する */
export async function getStripe(): Promise<Stripe> {
  const config = await resolveStripeConfig();
  if (!config.secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  if (_stripeCache && _stripeCache.mode === config.mode && _stripeCache.secretKey === config.secretKey) {
    return _stripeCache.client;
  }
  const client = new Stripe(config.secretKey, {
    apiVersion: '2024-10-28.acacia' as Stripe.LatestApiVersion,
    typescript: true,
  });
  _stripeCache = { mode: config.mode, secretKey: config.secretKey, client };
  return client;
}

/** 現在のモードに応じた Webhook Secret を取得する (署名検証用) */
export async function getStripeWebhookSecret(): Promise<string> {
  const config = await resolveStripeConfig();
  return config.webhookSecret;
}

/**
 * DB に保存済みの stripeCustomerId が現在の Stripe モードに実在するかを検証し、
 * 実在しない (テスト→本番の切り替え等で resource_missing になる) / 削除済みなら
 * null を返す。呼び出し側はその場合に顧客を作り直す。
 */
export async function verifyStripeCustomer(
  stripe: Stripe,
  customerId: string | null | undefined,
): Promise<string | null> {
  if (!customerId) return null;
  try {
    const existing = await stripe.customers.retrieve(customerId);
    if ((existing as { deleted?: boolean }).deleted) return null;
    return customerId;
  } catch {
    return null;
  }
}

export async function getPriceId(
  plan: 'STANDARD' | 'PREMIUM',
  interval: 'MONTH' | 'YEAR',
): Promise<string | undefined> {
  const config = await resolveStripeConfig();
  if (plan === 'STANDARD') {
    return interval === 'MONTH' ? config.prices.standardMonthly : config.prices.standardYearly;
  }
  return interval === 'MONTH' ? config.prices.premiumMonthly : config.prices.premiumYearly;
}

export async function planFromPriceId(priceId: string): Promise<'STANDARD' | 'PREMIUM' | null> {
  const config = await resolveStripeConfig();
  const p = config.prices;
  if (priceId === p.standardMonthly || priceId === p.standardYearly) return 'STANDARD';
  if (priceId === p.premiumMonthly || priceId === p.premiumYearly) return 'PREMIUM';
  return null;
}

export async function intervalFromPriceId(priceId: string): Promise<'MONTH' | 'YEAR' | null> {
  const config = await resolveStripeConfig();
  const p = config.prices;
  if (priceId === p.standardMonthly || priceId === p.premiumMonthly) return 'MONTH';
  if (priceId === p.standardYearly || priceId === p.premiumYearly) return 'YEAR';
  return null;
}
