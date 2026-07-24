/**
 * Stripe SDK シングルトン (Lambda コンテナ再利用最適化)
 *
 * 秘密鍵は resolveStripeRuntime() 経由で取得する。
 *   - LIVE モード: SSM SecureString の本番キー
 *   - TEST モード: AppSetting のテストキー (管理画面トグル)
 * 環境変数に直接埋め込まないことで、CFn テンプレートにも CloudWatch Logs にも
 * 平文の secret が残らない。
 *
 * モード切り替え (本番⇔テスト) で secret key が変わったらクライアントを作り直す。
 */
import Stripe from 'stripe';
import { resolveStripeRuntime } from './secrets';

let _stripe: Stripe | null = null;
let _stripeKey: string | null = null;

function buildClient(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    apiVersion: '2024-10-28.acacia' as Stripe.LatestApiVersion,
    typescript: true,
    maxNetworkRetries: 2,
    timeout: 8000,
  });
}

/**
 * 指定の secret key で Stripe クライアントを取得 (key が変わったら作り直す)。
 * index.ts が resolveStripeRuntime() 済みの key を渡すことで、
 * DB read の重複を避けつつモード一貫性を保つ。
 */
export function getStripeForKey(secretKey: string): Stripe {
  if (_stripe && _stripeKey === secretKey) return _stripe;
  _stripe = buildClient(secretKey);
  _stripeKey = secretKey;
  return _stripe;
}

/**
 * Stripe クライアントを取得 (現在の有効モードを解決してから)。
 * ハンドラ内から追加の Stripe 呼び出し (customers.retrieve 等) をするときに使う。
 */
export async function getStripe(): Promise<Stripe> {
  const runtime = await resolveStripeRuntime();
  return getStripeForKey(runtime.secretKey);
}
