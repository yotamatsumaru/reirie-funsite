/**
 * SSM Parameter Store から SecureString / String を取得するヘルパー。
 *
 * Lambda Environment Variables には SecureString を直接埋め込めない (CFn 制約)。
 * そのため、SSM Parameter 名だけを環境変数で渡し、Lambda 起動時に
 * SDK 経由で値を取得 → コンテナ再利用でキャッシュする方式を採用。
 *
 * 必要な IAM: ssm:GetParameter / kms:Decrypt (SecureString の場合)
 *
 * @aws-sdk/client-ssm は Lambda Node.js 20 runtime に含まれているため
 * バンドル不要 (package.json の esbuild --external:@aws-sdk/* と整合)。
 *
 * ## モード切り替え (A-1) について
 * 本来 Lambda は「本番キー固定」でフェイルセーフ稼働させる設計だったが、
 * 管理画面のテスト/本番トグル (AppSetting: stripe.mode) を Lambda 側でも
 * 尊重できるように拡張した。resolveStripeRuntime() が現在の有効モードに応じて
 * 「実際に使うキー・Webhook Secret・Price ID」を返す。
 *   - LIVE           → SSM の本番キー (従来どおり)
 *   - TEST (かつ設定済) → AppSetting のテストキー
 * テスト資格情報が未設定なら安全側で LIVE にフォールバックする。
 */
import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm';
import { isStripeTestCredentialsUsable, type StripeMode } from '@idol/shared';
import { getStripeMode, getStripeTestCredentials } from './app-setting';

const ssm = new SSMClient({});

interface ResolvedSecrets {
  stripeSecretKey: string;
  stripeWebhookSecret: string;
}

let cache: ResolvedSecrets | null = null;

/**
 * 環境変数で指定された SSM Parameter 名から実値を一括取得 (1 回の API コール)。
 * コンテナ再利用時はキャッシュを返す。
 *
 * ここで返すのは常に「本番 (LIVE)」用の secret。モード切り替えは
 * resolveStripeRuntime() 側で吸収する。
 */
export async function getSecrets(): Promise<ResolvedSecrets> {
  if (cache) return cache;

  const secretKeyParamName = process.env.STRIPE_SECRET_KEY_PARAM;
  const webhookSecretParamName = process.env.STRIPE_WEBHOOK_SECRET_PARAM;

  if (!secretKeyParamName || !webhookSecretParamName) {
    throw new Error(
      'STRIPE_SECRET_KEY_PARAM / STRIPE_WEBHOOK_SECRET_PARAM environment variables are required',
    );
  }

  const res = await ssm.send(
    new GetParametersCommand({
      Names: [secretKeyParamName, webhookSecretParamName],
      WithDecryption: true,
    }),
  );

  const params = res.Parameters ?? [];
  const byName = new Map<string, string>();
  for (const p of params) {
    if (p.Name && p.Value) byName.set(p.Name, p.Value);
  }
  const stripeSecretKey = byName.get(secretKeyParamName);
  const stripeWebhookSecret = byName.get(webhookSecretParamName);

  if (!stripeSecretKey || !stripeWebhookSecret) {
    const missing = (res.InvalidParameters ?? []).join(', ');
    throw new Error(
      `Failed to fetch Stripe secrets from SSM. Missing: ${missing || '(unknown)'}`,
    );
  }

  const resolved: ResolvedSecrets = { stripeSecretKey, stripeWebhookSecret };
  cache = resolved;
  return resolved;
}

/** Price ID のマッピング (TEST モード時に AppSetting の値で上書きするため) */
export interface StripePriceMap {
  standardMonthly?: string;
  standardYearly?: string;
  premiumMonthly?: string;
  premiumYearly?: string;
}

/** resolveStripeRuntime() の戻り値 */
export interface StripeRuntime {
  mode: StripeMode;
  secretKey: string;
  webhookSecret: string;
  /**
   * TEST モードのときだけ Price ID を返す。
   * LIVE モードでは undefined (plan-mapping.ts が環境変数の本番 Price ID を使う)。
   */
  prices?: StripePriceMap;
}

/**
 * 現在有効な Stripe ランタイム設定 (モード・キー・Webhook Secret・Price ID) を解決する。
 *
 * - AppSetting (stripe.mode) が TEST かつ テスト資格情報 (secretKey/webhookSecret) が
 *   揃っている場合のみ TEST を採用する。
 * - それ以外 (LIVE / テスト未設定 / DB エラー) は SSM の本番 secret を使う (安全側)。
 *
 * ここではキャッシュしない。Lambda コンテナが warm reuse されても、
 * 管理画面でモードを切り替えたら次のイベントから反映させたいため
 * (毎回 DB を 1〜2 read する軽量コスト)。
 */
export async function resolveStripeRuntime(): Promise<StripeRuntime> {
  let mode: StripeMode = 'LIVE';
  try {
    mode = await getStripeMode();
  } catch {
    mode = 'LIVE';
  }

  if (mode === 'TEST') {
    try {
      const test = await getStripeTestCredentials();
      if (isStripeTestCredentialsUsable(test)) {
        return {
          mode: 'TEST',
          secretKey: test.secretKey,
          webhookSecret: test.webhookSecret,
          prices: {
            standardMonthly: test.priceStandardMonthly || undefined,
            standardYearly: test.priceStandardYearly || undefined,
            premiumMonthly: test.pricePremiumMonthly || undefined,
            premiumYearly: test.pricePremiumYearly || undefined,
          },
        };
      }
    } catch {
      // フォールスルーして LIVE を使う
    }
  }

  const prod = await getSecrets();
  return {
    mode: 'LIVE',
    secretKey: prod.stripeSecretKey,
    webhookSecret: prod.stripeWebhookSecret,
  };
}

/**
 * テスト用にキャッシュをクリア。
 */
export function _resetSecretsCache(): void {
  cache = null;
}
