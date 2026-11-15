import {
  isLiveSubscription,
  isManualSubscription,
  liveSubscriptionWhere,
} from './subscription-status';

const now = new Date('2026-11-15T00:00:00Z');
const past = new Date('2026-11-01T00:00:00Z');
const future = new Date('2026-12-01T00:00:00Z');

describe('isLiveSubscription', () => {
  it('Stripe 経由の有効契約は有料 (期限日は見ない。Webhook で更新されるため)', () => {
    for (const status of ['ACTIVE', 'TRIALING', 'PAST_DUE']) {
      expect(
        isLiveSubscription({ status, stripeSubscriptionId: 'sub_123', currentPeriodEnd: past }, now),
      ).toBe(true);
    }
  });

  it('解約済み・未払いなどは無料', () => {
    for (const status of ['CANCELED', 'UNPAID', 'INCOMPLETE', 'INCOMPLETE_EXPIRED']) {
      expect(
        isLiveSubscription({ status, stripeSubscriptionId: 'sub_123', currentPeriodEnd: future }, now),
      ).toBe(false);
    }
  });

  it('手動付与は期限内なら有料', () => {
    expect(
      isLiveSubscription(
        { status: 'ACTIVE', stripeSubscriptionId: 'manual_abc', currentPeriodEnd: future },
        now,
      ),
    ).toBe(true);
  });

  it('手動付与は期限を過ぎたら (ステータスが ACTIVE のままでも) 無料', () => {
    expect(
      isLiveSubscription(
        { status: 'ACTIVE', stripeSubscriptionId: 'manual_abc', currentPeriodEnd: past },
        now,
      ),
    ).toBe(false);
    // ちょうど期限の瞬間も無料
    expect(
      isLiveSubscription(
        { status: 'ACTIVE', stripeSubscriptionId: 'manual_abc', currentPeriodEnd: now },
        now,
      ),
    ).toBe(false);
  });
});

describe('liveSubscriptionWhere', () => {
  it('有効ステータス + 手動付与の期限切れを除く条件になる', () => {
    expect(liveSubscriptionWhere(now)).toEqual({
      status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
      NOT: { stripeSubscriptionId: { startsWith: 'manual_' }, currentPeriodEnd: { lte: now } },
    });
  });

  it('ステータスを絞れる (月次ボーナス等)', () => {
    expect(liveSubscriptionWhere(now, ['ACTIVE', 'TRIALING']).status).toEqual({
      in: ['ACTIVE', 'TRIALING'],
    });
  });
});

describe('isManualSubscription', () => {
  it('manual_ で始まるものだけ', () => {
    expect(isManualSubscription('manual_1')).toBe(true);
    expect(isManualSubscription('sub_1')).toBe(false);
  });
});
