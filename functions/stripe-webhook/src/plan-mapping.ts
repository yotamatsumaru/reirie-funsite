/**
 * Stripe price.id → 内部の PlanType / BillingInterval マッピング
 *
 * 環境変数で設定された Price ID と一致するか判定。
 * 一致しない場合は STANDARD / MONTH を fallback として返す
 * (運用ではアラート対象とすべき)。
 */
export type PlanType = 'STANDARD' | 'PREMIUM';
export type BillingInterval = 'MONTH' | 'YEAR';

export function planFromPriceId(priceId: string): PlanType | null {
  const sm = process.env.STRIPE_PRICE_STANDARD_MONTHLY;
  const sy = process.env.STRIPE_PRICE_STANDARD_YEARLY;
  const pm = process.env.STRIPE_PRICE_PREMIUM_MONTHLY;
  const py = process.env.STRIPE_PRICE_PREMIUM_YEARLY;
  if (priceId === sm || priceId === sy) return 'STANDARD';
  if (priceId === pm || priceId === py) return 'PREMIUM';
  return null;
}

export function intervalFromPriceId(priceId: string): BillingInterval | null {
  const sm = process.env.STRIPE_PRICE_STANDARD_MONTHLY;
  const pm = process.env.STRIPE_PRICE_PREMIUM_MONTHLY;
  const sy = process.env.STRIPE_PRICE_STANDARD_YEARLY;
  const py = process.env.STRIPE_PRICE_PREMIUM_YEARLY;
  if (priceId === sm || priceId === pm) return 'MONTH';
  if (priceId === sy || priceId === py) return 'YEAR';
  return null;
}

/**
 * Stripe SubscriptionStatus → 内部 Enum
 */
export function mapSubscriptionStatus(
  s: string,
):
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'UNPAID'
  | 'INCOMPLETE'
  | 'INCOMPLETE_EXPIRED' {
  switch (s) {
    case 'trialing':
      return 'TRIALING';
    case 'active':
      return 'ACTIVE';
    case 'past_due':
      return 'PAST_DUE';
    case 'canceled':
      return 'CANCELED';
    case 'unpaid':
      return 'UNPAID';
    case 'incomplete_expired':
      return 'INCOMPLETE_EXPIRED';
    default:
      return 'INCOMPLETE';
  }
}
