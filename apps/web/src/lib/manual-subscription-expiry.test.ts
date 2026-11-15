const findMany = jest.fn();
const updateMany = jest.fn();
const auditCreate = jest.fn();
jest.mock('@idol/db', () => ({
  prisma: {
    subscription: { findMany: (...a: unknown[]) => findMany(...a), updateMany: (...a: unknown[]) => updateMany(...a) },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
  },
}));

import { expireManualSubscriptions } from './manual-subscription-expiry';

const now = new Date('2026-11-15T00:00:00Z');

beforeEach(() => {
  findMany.mockReset();
  updateMany.mockReset().mockResolvedValue({ count: 0 });
  auditCreate.mockReset().mockResolvedValue({});
});

it('期限切れの手動付与だけを対象に検索する', async () => {
  findMany.mockResolvedValue([]);
  await expireManualSubscriptions(now);
  expect(findMany.mock.calls[0][0].where).toEqual({
    stripeSubscriptionId: { startsWith: 'manual_' },
    status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
    currentPeriodEnd: { lte: now },
  });
  expect(updateMany).not.toHaveBeenCalled();
});

it('見つかったものを CANCELED にし、1 件ずつ監査ログを残す', async () => {
  findMany.mockResolvedValue([
    { id: 's1', userId: 'u1', planType: 'PREMIUM', currentPeriodEnd: new Date('2026-11-01T00:00:00Z') },
    { id: 's2', userId: 'u2', planType: 'STANDARD', currentPeriodEnd: new Date('2026-11-10T00:00:00Z') },
  ]);
  const r = await expireManualSubscriptions(now);
  expect(r).toEqual({ expired: 2, subscriptionIds: ['s1', 's2'] });
  expect(updateMany).toHaveBeenCalledWith({
    where: { id: { in: ['s1', 's2'] }, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
    data: { status: 'CANCELED', canceledAt: now, cancelAtPeriodEnd: false },
  });
  expect(auditCreate).toHaveBeenCalledTimes(2);
  expect(auditCreate.mock.calls[0][0].data).toMatchObject({
    userId: null,
    action: 'subscription.manual.expire',
    resource: 'subscription:s1',
  });
});
