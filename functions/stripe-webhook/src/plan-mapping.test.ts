import {
  planFromPriceId,
  intervalFromPriceId,
  mapSubscriptionStatus,
  planFromMetadata,
  intervalFromMetadata,
} from './plan-mapping';

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

  it('PriceMap を渡すと環境変数より優先される (TEST モード想定)', () => {
    const testPrices = {
      standardMonthly: 'price_test_sm',
      standardYearly: 'price_test_sy',
      premiumMonthly: 'price_test_pm',
      premiumYearly: 'price_test_py',
    };
    // テスト用 Price ID で判定できる
    expect(planFromPriceId('price_test_pm', testPrices)).toBe('PREMIUM');
    expect(intervalFromPriceId('price_test_py', testPrices)).toBe('YEAR');
    // 本番 Price ID は TEST の PriceMap には含まれないので null
    expect(planFromPriceId('price_sm', testPrices)).toBeNull();
  });

  it('PriceMap の一部だけ指定した場合、未指定分は環境変数へフォールバック', () => {
    const partial = { premiumMonthly: 'price_test_pm' };
    expect(planFromPriceId('price_test_pm', partial)).toBe('PREMIUM');
    // standardMonthly は未指定 → 環境変数 price_sm が使われる
    expect(planFromPriceId('price_sm', partial)).toBe('STANDARD');
  });

  it('planFromMetadata は metadata.plan からプランを判定する', () => {
    expect(planFromMetadata({ plan: 'PREMIUM' })).toBe('PREMIUM');
    expect(planFromMetadata({ plan: 'STANDARD' })).toBe('STANDARD');
    // 大文字小文字・前後空白を許容
    expect(planFromMetadata({ plan: 'premium' })).toBe('PREMIUM');
    expect(planFromMetadata({ plan: '  Standard  ' })).toBe('STANDARD');
    // FREE や不明値・未指定は null (呼び出し側で Price ID / fallback へ)
    expect(planFromMetadata({ plan: 'FREE' })).toBeNull();
    expect(planFromMetadata({ plan: 'xxx' })).toBeNull();
    expect(planFromMetadata({})).toBeNull();
    expect(planFromMetadata(null)).toBeNull();
  });

  it('intervalFromMetadata は metadata.interval から請求間隔を判定する', () => {
    expect(intervalFromMetadata({ interval: 'MONTH' })).toBe('MONTH');
    expect(intervalFromMetadata({ interval: 'year' })).toBe('YEAR');
    // checkout が 'monthly'/'yearly' を渡すケースも許容
    expect(intervalFromMetadata({ interval: 'monthly' })).toBe('MONTH');
    expect(intervalFromMetadata({ interval: 'yearly' })).toBe('YEAR');
    expect(intervalFromMetadata({})).toBeNull();
    expect(intervalFromMetadata(null)).toBeNull();
  });
});
