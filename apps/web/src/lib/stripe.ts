import Stripe from 'stripe';
import { env } from './env';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!env.stripe.secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    _stripe = new Stripe(env.stripe.secretKey, {
      apiVersion: '2024-10-28.acacia' as Stripe.LatestApiVersion,
      typescript: true,
    });
  }
  return _stripe;
}

export function getPriceId(
  plan: 'STANDARD' | 'PREMIUM',
  interval: 'MONTH' | 'YEAR',
): string | undefined {
  if (plan === 'STANDARD') {
    return interval === 'MONTH'
      ? env.stripe.prices.standardMonthly
      : env.stripe.prices.standardYearly;
  }
  return interval === 'MONTH'
    ? env.stripe.prices.premiumMonthly
    : env.stripe.prices.premiumYearly;
}

export function planFromPriceId(priceId: string): 'STANDARD' | 'PREMIUM' | null {
  const p = env.stripe.prices;
  if (priceId === p.standardMonthly || priceId === p.standardYearly) return 'STANDARD';
  if (priceId === p.premiumMonthly || priceId === p.premiumYearly) return 'PREMIUM';
  return null;
}

export function intervalFromPriceId(priceId: string): 'MONTH' | 'YEAR' | null {
  const p = env.stripe.prices;
  if (priceId === p.standardMonthly || priceId === p.premiumMonthly) return 'MONTH';
  if (priceId === p.standardYearly || priceId === p.premiumYearly) return 'YEAR';
  return null;
}
