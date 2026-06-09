/**
 * Stripe SDK シングルトン (Lambda コンテナ再利用最適化)
 *
 * 秘密鍵は SSM SecureString から動的取得 (secrets.ts 経由)。
 * 環境変数に直接埋め込まないことで、CFn テンプレートにも CloudWatch Logs にも
 * 平文の secret が残らない。
 */
import Stripe from 'stripe';
import { getSecrets } from './secrets';

let _stripe: Stripe | null = null;

/**
 * Stripe クライアントを取得 (初回は SSM から secret を取得)。
 */
export async function getStripe(): Promise<Stripe> {
  if (_stripe) return _stripe;
  const { stripeSecretKey } = await getSecrets();
  _stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2024-10-28.acacia' as Stripe.LatestApiVersion,
    typescript: true,
    maxNetworkRetries: 2,
    timeout: 8000,
  });
  return _stripe;
}
