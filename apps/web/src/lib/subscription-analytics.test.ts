/**
 * /super-admin/subscriptions のページ高速化リファクタリングで切り出した
 * 集計ロジック (subscription-analytics.ts) のテスト。
 *
 * 純粋関数 (buildPlanStats / buildTrendMonthKeys) は実 DB 無しで検証し、
 * DB を叩く関数群は @idol/db を軽量スタブに差し替えて検証する。
 */

type Call = { model: string; op: string; args: unknown };
const calls: Call[] = [];

let subscriptionGroupByResult: unknown[] = [];
let subscriptionCountResult: number | ((args: unknown) => number) = 0;
let userFindManyResult: unknown[] = [];
let queryRawResults: unknown[][] = [];

jest.mock('@idol/db', () => {
  return {
    prisma: {
      subscription: {
        groupBy: (args: unknown) => {
          calls.push({ model: 'subscription', op: 'groupBy', args });
          return Promise.resolve(subscriptionGroupByResult);
        },
        count: (args: unknown) => {
          calls.push({ model: 'subscription', op: 'count', args });
          const v =
            typeof subscriptionCountResult === 'function'
              ? (subscriptionCountResult as (a: unknown) => number)(args)
              : subscriptionCountResult;
          return Promise.resolve(v);
        },
        findMany: (args: unknown) => {
          calls.push({ model: 'subscription', op: 'findMany', args });
          return Promise.resolve([]);
        },
      },
      user: {
        findMany: (args: unknown) => {
          calls.push({ model: 'user', op: 'findMany', args });
          return Promise.resolve(userFindManyResult);
        },
      },
      $queryRaw: (..._args: unknown[]) => {
        calls.push({ model: '$queryRaw', op: 'call', args: _args });
        const next = queryRawResults.shift();
        return Promise.resolve(next ?? []);
      },
    },
  };
});

import {
  buildPlanStats,
  buildTrendMonthKeys,
  findDuplicateLiveUsers,
  getRefundedSubscriptionIds,
} from './subscription-analytics';

beforeEach(() => {
  calls.length = 0;
  subscriptionGroupByResult = [];
  subscriptionCountResult = 0;
  userFindManyResult = [];
  queryRawResults = [];
});

describe('buildTrendMonthKeys', () => {
  it('直近12ヶ月 (今月含む) の年月キーを古い順で返す', () => {
    const keys = buildTrendMonthKeys(new Date(2026, 8, 13)); // 2026-09-13
    expect(keys).toHaveLength(12);
    expect(keys[0]).toBe('2025-10');
    expect(keys[11]).toBe('2026-09');
  });
});

describe('buildPlanStats', () => {
  it('プラン別・課金サイクル別に件数とMRRを集計する', () => {
    const { planStats, totalMrr } = buildPlanStats([
      { planType: 'STANDARD', billingInterval: 'MONTH', count: 3 },
      { planType: 'PREMIUM', billingInterval: 'YEAR', count: 2 },
    ]);
    expect(planStats.STANDARD.count).toBe(3);
    expect(planStats.STANDARD.monthCount).toBe(3);
    expect(planStats.STANDARD.yearCount).toBe(0);
    expect(planStats.PREMIUM.count).toBe(2);
    expect(planStats.PREMIUM.yearCount).toBe(2);
    // STANDARD: 666円/月 * 3 = 1998, PREMIUM: (7920/12切上げ)=660円 * 2 = 1320
    expect(planStats.STANDARD.mrr).toBe(666 * 3);
    expect(totalMrr).toBe(planStats.STANDARD.mrr + planStats.PREMIUM.mrr);
  });

  it('データが無いプランは 0 件・MRR 0 のまま返す', () => {
    const { planStats } = buildPlanStats([]);
    expect(planStats.STANDARD).toEqual({ count: 0, mrr: 0, monthCount: 0, yearCount: 0 });
    expect(planStats.PREMIUM).toEqual({ count: 0, mrr: 0, monthCount: 0, yearCount: 0 });
  });
});

describe('getRefundedSubscriptionIds', () => {
  it('$queryRaw の結果 (返金済みかつ成功が無い契約ID) をそのまま Set にする', async () => {
    queryRawResults = [[{ id: 'sub-1' }, { id: 'sub-2' }]];
    const result = await getRefundedSubscriptionIds();
    expect(result).toEqual(new Set(['sub-1', 'sub-2']));
    expect(calls[0].model).toBe('$queryRaw');
  });

  it('該当なしの場合は空の Set を返す', async () => {
    queryRawResults = [[]];
    const result = await getRefundedSubscriptionIds();
    expect(result.size).toBe(0);
  });
});

describe('findDuplicateLiveUsers', () => {
  it('groupBy で複数件ヒットしたユーザーの情報を user.findMany から補完して返す', async () => {
    subscriptionGroupByResult = [
      { userId: 'u1', _count: { _all: 2 } },
      { userId: 'u2', _count: { _all: 3 } },
    ];
    userFindManyResult = [
      { id: 'u1', email: 'u1@example.com', displayName: '太郎' },
      { id: 'u2', email: 'u2@example.com', displayName: null },
    ];

    const result = await findDuplicateLiveUsers(new Set());
    expect(result).toEqual([
      { userId: 'u1', email: 'u1@example.com', displayName: '太郎', count: 2 },
      { userId: 'u2', email: 'u2@example.com', displayName: '（不明）', count: 3 },
    ]);

    // groupBy の where に返金済み除外条件 (notIn) が渡っていないこと (空セットなので undefined)
    const groupByCall = calls.find((c) => c.op === 'groupBy');
    const where = (groupByCall?.args as { where: { id?: unknown } }).where;
    expect(where.id).toBeUndefined();
  });

  it('返金済み契約IDを notIn 条件として渡す', async () => {
    subscriptionGroupByResult = [];
    await findDuplicateLiveUsers(new Set(['sub-refunded']));
    const groupByCall = calls.find((c) => c.op === 'groupBy');
    const where = (groupByCall?.args as { where: { id?: { notIn: string[] } } }).where;
    expect(where.id?.notIn).toEqual(['sub-refunded']);
  });

  it('重複ユーザーが0件ならuser.findManyを呼ばずに空配列を返す', async () => {
    subscriptionGroupByResult = [];
    const result = await findDuplicateLiveUsers(new Set());
    expect(result).toEqual([]);
    expect(calls.some((c) => c.model === 'user')).toBe(false);
  });
});
