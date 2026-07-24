/**
 * Stripe price.id → 内部の PlanType / BillingInterval マッピング
 *
 * 通常は環境変数で設定された本番 Price ID と一致するか判定する。
 * ただし TEST モード時は AppSetting のテスト用 Price ID が渡されるため、
 * その場合は渡された PriceMap を優先して判定する。
 * 一致しない場合は null を返す (呼び出し側で STANDARD / MONTH を fallback)。
 */
export type PlanType = 'STANDARD' | 'PREMIUM';
export type BillingInterval = 'MONTH' | 'YEAR';

/** TEST モード時に AppSetting から渡される Price ID セット */
export interface PriceMap {
  standardMonthly?: string;
  standardYearly?: string;
  premiumMonthly?: string;
  premiumYearly?: string;
}

/** 引数の PriceMap が無ければ環境変数 (本番 Price ID) を採用する */
function resolvePrices(overrides?: PriceMap): Required<
  Record<keyof PriceMap, string | undefined>
> {
  return {
    standardMonthly: overrides?.standardMonthly ?? process.env.STRIPE_PRICE_STANDARD_MONTHLY,
    standardYearly: overrides?.standardYearly ?? process.env.STRIPE_PRICE_STANDARD_YEARLY,
    premiumMonthly: overrides?.premiumMonthly ?? process.env.STRIPE_PRICE_PREMIUM_MONTHLY,
    premiumYearly: overrides?.premiumYearly ?? process.env.STRIPE_PRICE_PREMIUM_YEARLY,
  };
}

export function planFromPriceId(priceId: string, prices?: PriceMap): PlanType | null {
  const p = resolvePrices(prices);
  if (priceId === p.standardMonthly || priceId === p.standardYearly) return 'STANDARD';
  if (priceId === p.premiumMonthly || priceId === p.premiumYearly) return 'PREMIUM';
  return null;
}

export function intervalFromPriceId(priceId: string, prices?: PriceMap): BillingInterval | null {
  const p = resolvePrices(prices);
  if (priceId === p.standardMonthly || priceId === p.premiumMonthly) return 'MONTH';
  if (priceId === p.standardYearly || priceId === p.premiumYearly) return 'YEAR';
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
