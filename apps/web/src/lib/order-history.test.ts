/**
 * getUnifiedOrderHistory (EC 注文 + サブスク課金の統合履歴) のテスト。
 *
 * 検証内容:
 *  1. Order と Payment(SUBSCRIPTION) の両方が正規化され、作成日時の新しい順に
 *     マージされること。
 *  2. Payment(SUBSCRIPTION) 以外の kind (ONE_TIME_ORDER 等) は対象外であること
 *     (findMany の where 条件で絞り込まれることを呼び出し引数で検証)。
 *  3. limit がマージ後の結果にも適用されること。
 *  4. サブスクが紐付いていない Payment は、誤ったプラン名を出さないよう
 *     planLabel / intervalLabel が null になること
 *     (以前は STANDARD / 月額 に既定化して年額プランを誤表示していた)。
 */

const findManyCalls: { model: string; args: unknown }[] = [];

let orderRows: unknown[] = [];
let paymentRows: unknown[] = [];

jest.mock('@idol/db', () => {
  return {
    prisma: {
      order: {
        findMany: (args: unknown) => {
          findManyCalls.push({ model: 'order', args });
          return Promise.resolve(orderRows);
        },
      },
      payment: {
        findMany: (args: unknown) => {
          findManyCalls.push({ model: 'payment', args });
          return Promise.resolve(paymentRows);
        },
      },
    },
  };
});

import { getUnifiedOrderHistory } from './order-history';

beforeEach(() => {
  findManyCalls.length = 0;
  orderRows = [];
  paymentRows = [];
});

describe('getUnifiedOrderHistory', () => {
  it('Order と Payment(SUBSCRIPTION) を作成日時の新しい順にマージする', async () => {
    orderRows = [
      {
        id: 'order-1',
        orderNumber: 'ORD-1',
        status: 'PAID',
        totalAmount: 3000,
        createdAt: new Date('2026-07-01T00:00:00Z'),
        items: [{ productName: 'Tシャツ' }],
      },
    ];
    paymentRows = [
      {
        id: 'pay-1',
        status: 'SUCCEEDED',
        amount: 666,
        createdAt: new Date('2026-07-10T00:00:00Z'),
        subscription: { planType: 'STANDARD', billingInterval: 'MONTH' },
      },
    ];

    const result = await getUnifiedOrderHistory('user-1');

    expect(result).toHaveLength(2);
    // 新しい順 (7/10 のサブスク決済が先頭)
    expect(result[0]).toMatchObject({ type: 'SUBSCRIPTION_PAYMENT', id: 'pay-1', amount: 666 });
    expect(result[1]).toMatchObject({ type: 'ORDER', id: 'order-1', amount: 3000 });
  });

  it('payment.findMany は kind: SUBSCRIPTION で絞り込む', async () => {
    await getUnifiedOrderHistory('user-1');
    const paymentCall = findManyCalls.find((c) => c.model === 'payment');
    expect(paymentCall).toBeDefined();
    expect((paymentCall!.args as { where: { kind: string } }).where.kind).toBe('SUBSCRIPTION');
  });

  it('limit はマージ後の結果にも適用される', async () => {
    orderRows = Array.from({ length: 3 }, (_, i) => ({
      id: `order-${i}`,
      orderNumber: `ORD-${i}`,
      status: 'PAID',
      totalAmount: 1000,
      createdAt: new Date(2026, 6, 10 - i),
      items: [],
    }));
    paymentRows = Array.from({ length: 3 }, (_, i) => ({
      id: `pay-${i}`,
      status: 'SUCCEEDED',
      amount: 666,
      createdAt: new Date(2026, 6, 9 - i),
      subscription: { planType: 'PREMIUM', billingInterval: 'YEAR' },
    }));

    const result = await getUnifiedOrderHistory('user-1', 4);
    expect(result).toHaveLength(4);
    // 新しい順であることも確認
    const times = result.map((r) => r.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('サブスク未紐付けの Payment は planLabel / intervalLabel が null になる (誤ったプラン名を出さない)', async () => {
    paymentRows = [
      {
        id: 'pay-orphan',
        status: 'SUCCEEDED',
        amount: 666,
        createdAt: new Date('2026-07-01T00:00:00Z'),
        subscription: null,
      },
    ];

    const result = await getUnifiedOrderHistory('user-1');
    expect(result[0]).toMatchObject({
      type: 'SUBSCRIPTION_PAYMENT',
      planLabel: null,
      intervalLabel: null,
    });
  });

  it('サブスクの billingInterval=YEAR は「年額」と表示される', async () => {
    paymentRows = [
      {
        id: 'pay-yearly',
        status: 'SUCCEEDED',
        amount: 7920,
        createdAt: new Date('2026-07-01T00:00:00Z'),
        subscription: { planType: 'PREMIUM', billingInterval: 'YEAR' },
      },
    ];

    const result = await getUnifiedOrderHistory('user-1');
    expect(result[0]).toMatchObject({
      type: 'SUBSCRIPTION_PAYMENT',
      planLabel: 'プレミアム',
      intervalLabel: '年額',
    });
  });
});
