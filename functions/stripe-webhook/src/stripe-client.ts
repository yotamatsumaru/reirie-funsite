/**
 * Stripe SDK シングルトン (Lambda コンテナ再利用最適化)
 */
import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    _stripe = new Stripe(key, {
      apiVersion: '2024-10-28.acacia' as Stripe.LatestApiVersion,
      typescript: true,
      maxNetworkRetries: 2,
      timeout: 8000,
    });
  }
  return _stripe;
}
