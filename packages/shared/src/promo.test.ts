import { isPromoActive, PROMO_EFFECTIVE_PLAN } from './promo';

describe('isPromoActive', () => {
  const now = new Date('2026-07-13T00:00:00Z');
  it('null / undefined は無効', () => {
    expect(isPromoActive(null, now)).toBe(false);
    expect(isPromoActive(undefined, now)).toBe(false);
  });
  it('未来の日時は有効', () => {
    expect(isPromoActive(new Date('2026-07-14T00:00:00Z'), now)).toBe(true);
    expect(isPromoActive('2099-12-31T00:00:00Z', now)).toBe(true);
  });
  it('過去の日時は無効', () => {
    expect(isPromoActive(new Date('2026-07-12T00:00:00Z'), now)).toBe(false);
  });
  it('不正な文字列は無効', () => {
    expect(isPromoActive('not-a-date', now)).toBe(false);
  });
  it('PROMO_EFFECTIVE_PLAN は PREMIUM', () => {
    expect(PROMO_EFFECTIVE_PLAN).toBe('PREMIUM');
  });
});
