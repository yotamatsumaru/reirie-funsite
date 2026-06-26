/**
 * 会員ランク (5段階) 純粋ロジックの単体テスト
 */
import {
  MEMBER_RANKS,
  MEMBER_RANK_ORDER,
  DEFAULT_MEMBER_RANK,
  DEFAULT_MEMBER_RANK_TIERS,
  resolveMemberRank,
  normalizeMemberRankTiers,
  isMemberRank,
  MemberRankTiersSchema,
  type MemberRankTiers,
} from './membership-rank';

describe('ランク定義', () => {
  it('5段階・下位→上位の順', () => {
    expect(MEMBER_RANKS).toEqual(['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND']);
  });

  it('序列は単調増加', () => {
    let prev = -1;
    for (const r of MEMBER_RANKS) {
      expect(MEMBER_RANK_ORDER[r]).toBeGreaterThan(prev);
      prev = MEMBER_RANK_ORDER[r];
    }
  });

  it('isMemberRank', () => {
    expect(isMemberRank('GOLD')).toBe(true);
    expect(isMemberRank('gold')).toBe(false);
    expect(isMemberRank('UNKNOWN')).toBe(false);
    expect(isMemberRank(null)).toBe(false);
  });
});

describe('resolveMemberRank (既定条件)', () => {
  it('未達は最下位 BRONZE', () => {
    expect(resolveMemberRank({ loginDays: 0, purchaseCount: 0 })).toBe('BRONZE');
    expect(resolveMemberRank({ loginDays: 5, purchaseCount: 0 })).toBe('BRONZE');
  });

  it('SILVER は ログイン10 かつ 買い物1', () => {
    // 片方だけ満たしても昇格しない (AND)
    expect(resolveMemberRank({ loginDays: 10, purchaseCount: 0 })).toBe('BRONZE');
    expect(resolveMemberRank({ loginDays: 0, purchaseCount: 5 })).toBe('BRONZE');
    expect(resolveMemberRank({ loginDays: 10, purchaseCount: 1 })).toBe('SILVER');
  });

  it('GOLD は ログイン30 かつ 買い物3', () => {
    expect(resolveMemberRank({ loginDays: 30, purchaseCount: 3 })).toBe('GOLD');
    // ログインは足りるが買い物が足りない → SILVER 止まり
    expect(resolveMemberRank({ loginDays: 50, purchaseCount: 2 })).toBe('SILVER');
  });

  it('最上位 DIAMOND', () => {
    expect(resolveMemberRank({ loginDays: 180, purchaseCount: 10 })).toBe('DIAMOND');
    expect(resolveMemberRank({ loginDays: 9999, purchaseCount: 9999 })).toBe('DIAMOND');
  });

  it('満たす最上位を返す (PLATINUM)', () => {
    expect(resolveMemberRank({ loginDays: 100, purchaseCount: 5 })).toBe('PLATINUM');
    // 買い物が 5→4 に落ちると GOLD
    expect(resolveMemberRank({ loginDays: 100, purchaseCount: 4 })).toBe('GOLD');
  });
});

describe('resolveMemberRank (カスタム条件)', () => {
  it('管理画面で条件を変えると判定も変わる', () => {
    const tiers: MemberRankTiers = {
      BRONZE: { minLoginDays: 0, minPurchases: 0 },
      SILVER: { minLoginDays: 1, minPurchases: 0 },
      GOLD: { minLoginDays: 2, minPurchases: 0 },
      PLATINUM: { minLoginDays: 3, minPurchases: 0 },
      DIAMOND: { minLoginDays: 4, minPurchases: 0 },
    };
    expect(resolveMemberRank({ loginDays: 0, purchaseCount: 0 }, tiers)).toBe('BRONZE');
    expect(resolveMemberRank({ loginDays: 2, purchaseCount: 0 }, tiers)).toBe('GOLD');
    expect(resolveMemberRank({ loginDays: 4, purchaseCount: 0 }, tiers)).toBe('DIAMOND');
  });
});

describe('normalizeMemberRankTiers', () => {
  it('欠落は既定で補完、BRONZE は常に 0/0', () => {
    const n = normalizeMemberRankTiers({ DIAMOND: { minLoginDays: 5, minPurchases: 2 } });
    expect(n.BRONZE).toEqual({ minLoginDays: 0, minPurchases: 0 });
    expect(n.DIAMOND).toEqual({ minLoginDays: 5, minPurchases: 2 });
    expect(n.SILVER).toEqual(DEFAULT_MEMBER_RANK_TIERS.SILVER);
  });

  it('負値・小数は丸めて 0 以上の整数に', () => {
    const n = normalizeMemberRankTiers({
      GOLD: { minLoginDays: -3, minPurchases: 2.9 },
    });
    expect(n.GOLD.minLoginDays).toBe(0);
    expect(n.GOLD.minPurchases).toBe(2);
  });

  it('null でも完全な tiers を返す', () => {
    const n = normalizeMemberRankTiers(null);
    expect(Object.keys(n).sort()).toEqual([...MEMBER_RANKS].sort());
  });
});

describe('MemberRankTiersSchema', () => {
  it('正しい形は通る', () => {
    expect(MemberRankTiersSchema.safeParse(DEFAULT_MEMBER_RANK_TIERS).success).toBe(true);
  });

  it('ランク欠落は不可', () => {
    expect(
      MemberRankTiersSchema.safeParse({
        BRONZE: { minLoginDays: 0, minPurchases: 0 },
      }).success,
    ).toBe(false);
  });

  it('負値は不可', () => {
    const bad = {
      ...DEFAULT_MEMBER_RANK_TIERS,
      SILVER: { minLoginDays: -1, minPurchases: 0 },
    };
    expect(MemberRankTiersSchema.safeParse(bad).success).toBe(false);
  });
});

describe('デフォルト', () => {
  it('DEFAULT_MEMBER_RANK は BRONZE', () => {
    expect(DEFAULT_MEMBER_RANK).toBe('BRONZE');
  });
});
