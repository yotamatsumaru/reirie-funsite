const update = jest.fn();
jest.mock('@idol/db', () => ({ prisma: { subscription: { update: (...a: unknown[]) => update(...a) } } }));

import { applyAdminCancel, type StripeSubscriptionApi } from './admin-subscription-cancel';

function fakeStripe(over: Partial<{ cancel: jest.Mock; update: jest.Mock; release: jest.Mock }> = {}) {
  const api = {
    cancel: over.cancel ?? jest.fn().mockResolvedValue({}),
    update: over.update ?? jest.fn().mockResolvedValue({}),
    release: over.release ?? jest.fn().mockResolvedValue({}),
  };
  const stripe = {
    subscriptions: { cancel: api.cancel, update: api.update },
    subscriptionSchedules: { release: api.release },
  } as unknown as StripeSubscriptionApi;
  return { api, getStripe: jest.fn().mockResolvedValue(stripe) };
}

const now = new Date('2026-11-15T00:00:00Z');
const stripeSub = { id: 'db-1', stripeSubscriptionId: 'sub_123', stripeScheduleId: null };

beforeEach(() => update.mockReset().mockResolvedValue({}));

describe('applyAdminCancel: 即時解約', () => {
  it('Stripe を解約してから DB を CANCELED にする', async () => {
    const { api, getStripe } = fakeStripe();
    const r = await applyAdminCancel(stripeSub, { action: 'cancel_immediate' }, getStripe, now);
    expect(api.cancel).toHaveBeenCalledWith('sub_123');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'db-1' },
      data: expect.objectContaining({ status: 'CANCELED', canceledAt: now, cancelAtPeriodEnd: false }),
    });
    expect(r).toEqual({ stripe: 'canceled', releasedSchedule: false });
  });

  it('Stripe が失敗したら DB は変更しない (請求が続くのに解約済みと表示されるのを防ぐ)', async () => {
    const { getStripe } = fakeStripe({ cancel: jest.fn().mockRejectedValue(new Error('network')) });
    await expect(
      applyAdminCancel(stripeSub, { action: 'cancel_immediate' }, getStripe, now),
    ).rejects.toThrow('network');
    expect(update).not.toHaveBeenCalled();
  });

  it('Stripe に契約が無い (resource_missing) ときは DB だけ解約する', async () => {
    const err = Object.assign(new Error('No such subscription'), { code: 'resource_missing' });
    const { getStripe } = fakeStripe({ cancel: jest.fn().mockRejectedValue(err) });
    const r = await applyAdminCancel(stripeSub, { action: 'cancel_immediate' }, getStripe, now);
    expect(r.stripe).toBe('missing_in_stripe');
    expect(update).toHaveBeenCalled();
  });

  it('手動付与は Stripe を呼ばずに DB だけ解約する', async () => {
    const { getStripe } = fakeStripe();
    const r = await applyAdminCancel(
      { id: 'db-2', stripeSubscriptionId: 'manual_x', stripeScheduleId: null },
      { action: 'cancel_immediate' },
      getStripe,
      now,
    );
    expect(getStripe).not.toHaveBeenCalled();
    expect(r.stripe).toBe('skipped_manual');
    expect(update).toHaveBeenCalled();
  });

  it('プラン変更の予約があれば先に解除し、DB の予約も消す', async () => {
    const { api, getStripe } = fakeStripe();
    const r = await applyAdminCancel(
      { ...stripeSub, stripeScheduleId: 'sub_sched_1' },
      { action: 'cancel_immediate' },
      getStripe,
      now,
    );
    expect(api.release).toHaveBeenCalledWith('sub_sched_1');
    expect(api.release.mock.invocationCallOrder[0]).toBeLessThan(api.cancel.mock.invocationCallOrder[0]);
    expect(r.releasedSchedule).toBe(true);
    expect(update.mock.calls[0][0].data).toMatchObject({ scheduledPlanType: null, stripeScheduleId: null });
  });
});

describe('applyAdminCancel: 期末解約', () => {
  it('予約すると Stripe も cancel_at_period_end=true にする', async () => {
    const { api, getStripe } = fakeStripe();
    const r = await applyAdminCancel(
      stripeSub,
      { action: 'cancel_at_period_end', value: true },
      getStripe,
      now,
    );
    expect(api.update).toHaveBeenCalledWith('sub_123', { cancel_at_period_end: true });
    expect(update).toHaveBeenCalledWith({ where: { id: 'db-1' }, data: { cancelAtPeriodEnd: true } });
    expect(r.stripe).toBe('updated');
  });

  it('取り消すと Stripe も false に戻す (予約の解除はしない)', async () => {
    const { api, getStripe } = fakeStripe();
    await applyAdminCancel(
      { ...stripeSub, stripeScheduleId: 'sub_sched_1' },
      { action: 'cancel_at_period_end', value: false },
      getStripe,
      now,
    );
    expect(api.release).not.toHaveBeenCalled();
    expect(api.update).toHaveBeenCalledWith('sub_123', { cancel_at_period_end: false });
  });
});
