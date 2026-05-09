import { planFromPriceId, intervalFromPriceId, mapSubscriptionStatus } from './plan-mapping';

describe('plan-mapping', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      STRIPE_PRICE_STANDARD_MONTHLY: 'price_sm',
      STRIPE_PRICE_STANDARD_YEARLY: 'price_sy',
      STRIPE_PRICE_PREMIUM_MONTHLY: 'price_pm',
      STRIPE_PRICE_PREMIUM_YEARLY: 'price_py',
    };
  });
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('planFromPriceId は STANDARD/PREMIUM を返す', () => {
    expect(planFromPriceId('price_sm')).toBe('STANDARD');
    expect(planFromPriceId('price_sy')).toBe('STANDARD');
    expect(planFromPriceId('price_pm')).toBe('PREMIUM');
    expect(planFromPriceId('price_py')).toBe('PREMIUM');
    expect(planFromPriceId('price_unknown')).toBeNull();
  });

  it('intervalFromPriceId は MONTH/YEAR を返す', () => {
    expect(intervalFromPriceId('price_sm')).toBe('MONTH');
    expect(intervalFromPriceId('price_pm')).toBe('MONTH');
    expect(intervalFromPriceId('price_sy')).toBe('YEAR');
    expect(intervalFromPriceId('price_py')).toBe('YEAR');
    expect(intervalFromPriceId('price_unknown')).toBeNull();
  });

  it('mapSubscriptionStatus が大文字に変換', () => {
    expect(mapSubscriptionStatus('active')).toBe('ACTIVE');
    expect(mapSubscriptionStatus('past_due')).toBe('PAST_DUE');
    expect(mapSubscriptionStatus('canceled')).toBe('CANCELED');
    expect(mapSubscriptionStatus('trialing')).toBe('TRIALING');
  });
});
