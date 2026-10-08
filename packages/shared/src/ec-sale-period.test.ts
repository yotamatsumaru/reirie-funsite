import { getSaleStatus, isPurchasable, isViewable, validateSalePeriod } from './ec-sale-period';

const now = new Date('2026-10-09T12:00:00+09:00');
const past = new Date('2026-10-01T00:00:00+09:00');
const future = new Date('2026-10-20T21:00:00+09:00');

describe('getSaleStatus', () => {
  it('非公開なら HIDDEN (期間に関係なく)', () => {
    expect(getSaleStatus({ isActive: false, saleStartsAt: past }, now)).toBe('HIDDEN');
  });
  it('期間未設定なら ON_SALE', () => {
    expect(getSaleStatus({ isActive: true }, now)).toBe('ON_SALE');
  });
  it('開始が未来なら UPCOMING (ページは見えるが買えない)', () => {
    expect(getSaleStatus({ isActive: true, saleStartsAt: future }, now)).toBe('UPCOMING');
  });
  it('開始時刻ちょうどで ON_SALE になる', () => {
    expect(getSaleStatus({ isActive: true, saleStartsAt: now }, now)).toBe('ON_SALE');
  });
  it('終了を過ぎたら ENDED', () => {
    expect(getSaleStatus({ isActive: true, saleEndsAt: past }, now)).toBe('ENDED');
  });
  it('終了時刻ちょうどで ENDED', () => {
    expect(getSaleStatus({ isActive: true, saleEndsAt: now }, now)).toBe('ENDED');
  });
  it('ISO 文字列でも判定できる', () => {
    expect(getSaleStatus({ isActive: true, saleStartsAt: future.toISOString() }, now)).toBe('UPCOMING');
  });
});

describe('isPurchasable / isViewable', () => {
  it('ON_SALE のときだけ購入可', () => {
    expect(isPurchasable({ isActive: true }, now)).toBe(true);
    expect(isPurchasable({ isActive: true, saleStartsAt: future }, now)).toBe(false);
    expect(isPurchasable({ isActive: true, saleEndsAt: past }, now)).toBe(false);
    expect(isPurchasable({ isActive: false }, now)).toBe(false);
  });
  it('isActive なら発売前でも表示可', () => {
    expect(isViewable({ isActive: true, saleStartsAt: future })).toBe(true);
    expect(isViewable({ isActive: false })).toBe(false);
  });
});

describe('validateSalePeriod', () => {
  it('どちらも未設定は OK', () => {
    expect(validateSalePeriod(null, null)).toBeNull();
  });
  it('終了が開始より前はエラー', () => {
    expect(validateSalePeriod(future, past)).toMatch(/後にしてください/);
  });
  it('同時刻もエラー', () => {
    expect(validateSalePeriod(now, now)).toMatch(/後にしてください/);
  });
  it('不正な文字列はエラー', () => {
    expect(validateSalePeriod('not-a-date', null)).toMatch(/形式が不正/);
  });
});
