import { canAccess, canUseShop, planRank, requiredPlanLabel } from './access-control';

describe('canAccess', () => {
  it('PUBLIC は誰でもアクセス可', () => {
    expect(canAccess(undefined, 'PUBLIC')).toBe(true);
    expect(canAccess(null, 'PUBLIC')).toBe(true);
    expect(canAccess('FREE', 'PUBLIC')).toBe(true);
    expect(canAccess('STANDARD', 'PUBLIC')).toBe(true);
    expect(canAccess('PREMIUM', 'PUBLIC')).toBe(true);
  });

  it('MEMBERS は STANDARD 以上のみ', () => {
    expect(canAccess(undefined, 'MEMBERS')).toBe(false);
    expect(canAccess('FREE', 'MEMBERS')).toBe(false);
    expect(canAccess('STANDARD', 'MEMBERS')).toBe(true);
    expect(canAccess('PREMIUM', 'MEMBERS')).toBe(true);
  });

  it('PREMIUM は PREMIUM のみ', () => {
    expect(canAccess(undefined, 'PREMIUM')).toBe(false);
    expect(canAccess('FREE', 'PREMIUM')).toBe(false);
    expect(canAccess('STANDARD', 'PREMIUM')).toBe(false);
    expect(canAccess('PREMIUM', 'PREMIUM')).toBe(true);
  });
});

describe('canUseShop', () => {
  it('無料会員 (FREE) と未認証は物販を利用できない', () => {
    expect(canUseShop(undefined)).toBe(false);
    expect(canUseShop(null)).toBe(false);
    expect(canUseShop('FREE')).toBe(false);
  });

  it('スタンダード以上は物販を利用できる', () => {
    expect(canUseShop('STANDARD')).toBe(true);
    expect(canUseShop('PREMIUM')).toBe(true);
  });
});

describe('planRank / requiredPlanLabel', () => {
  it('プランの順位', () => {
    expect(planRank('FREE')).toBeLessThan(planRank('STANDARD'));
    expect(planRank('STANDARD')).toBeLessThan(planRank('PREMIUM'));
  });
  it('ラベル変換', () => {
    expect(requiredPlanLabel('MEMBERS')).toBe('スタンダード');
    expect(requiredPlanLabel('PREMIUM')).toBe('プレミアム');
  });
});
