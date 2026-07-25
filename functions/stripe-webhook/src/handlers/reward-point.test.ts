/**
 * reward-point ハンドラのユニットテスト
 * Prisma (../db) をモックして、Pui 付与・冪等性・メタデータ欠落を検証する。
 */

// prisma をモック (../db は db.ts 経由で @idol/db を読むため、db.ts をモックする)
const mockTx = {
  rewardPointPurchase: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  user: {
    update: jest.fn(),
  },
  puiTransaction: {
    create: jest.fn(),
  },
};

const mockPrisma = {
  $transaction: jest.fn(async (cb: (tx: typeof mockTx) => unknown) => cb(mockTx)),
};

jest.mock('../db', () => ({ prisma: mockPrisma }));

import { handleRewardPointPurchase } from './reward-point';
import type Stripe from 'stripe';

function sessionWith(metadata: Record<string, string>, paymentIntent = 'pi_test'): Stripe.Checkout.Session {
  return {
    id: 'cs_test',
    metadata,
    payment_intent: paymentIntent,
  } as unknown as Stripe.Checkout.Session;
}

describe('handleRewardPointPurchase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('purchaseId が無ければ missing_metadata で終了する', async () => {
    const res = await handleRewardPointPurchase(sessionWith({ kind: 'REWARD_POINT_PURCHASE' }));
    expect(res).toEqual({ ok: false, reason: 'missing_metadata' });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('PENDING の購入を SUCCEEDED にして Pui を付与する', async () => {
    mockTx.rewardPointPurchase.findUnique.mockResolvedValue({
      id: 'p1',
      userId: 'u1',
      pui: 500,
      amountJpy: 500,
      status: 'PENDING',
      stripePaymentIntentId: null,
    });
    mockTx.user.update.mockResolvedValue({ pui: 1500 });

    const res = await handleRewardPointPurchase(
      sessionWith({ kind: 'REWARD_POINT_PURCHASE', purchaseId: 'p1' }),
    );

    expect(res).toEqual({ ok: true });
    expect(mockTx.rewardPointPurchase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ status: 'SUCCEEDED', stripePaymentIntentId: 'pi_test' }),
      }),
    );
    expect(mockTx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: { pui: { increment: 500 } },
      }),
    );
    expect(mockTx.puiTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1',
          amount: 500,
          balance: 1500,
          reason: 'STRIPE_PURCHASE',
        }),
      }),
    );
  });

  it('既に SUCCEEDED なら冪等 no-op (二重付与しない)', async () => {
    mockTx.rewardPointPurchase.findUnique.mockResolvedValue({
      id: 'p1',
      userId: 'u1',
      pui: 500,
      amountJpy: 500,
      status: 'SUCCEEDED',
      stripePaymentIntentId: 'pi_old',
    });

    const res = await handleRewardPointPurchase(
      sessionWith({ kind: 'REWARD_POINT_PURCHASE', purchaseId: 'p1' }),
    );

    expect(res).toEqual({ ok: true });
    expect(mockTx.rewardPointPurchase.update).not.toHaveBeenCalled();
    expect(mockTx.user.update).not.toHaveBeenCalled();
    expect(mockTx.puiTransaction.create).not.toHaveBeenCalled();
  });

  it('購入が見つからなければ purchase_not_found', async () => {
    mockTx.rewardPointPurchase.findUnique.mockResolvedValue(null);
    const res = await handleRewardPointPurchase(
      sessionWith({ kind: 'REWARD_POINT_PURCHASE', purchaseId: 'nope' }),
    );
    expect(res).toEqual({ ok: false, reason: 'purchase_not_found' });
  });

  it('不正な Pui 数 (0 以下) は付与しない', async () => {
    mockTx.rewardPointPurchase.findUnique.mockResolvedValue({
      id: 'p1',
      userId: 'u1',
      pui: 0,
      amountJpy: 500,
      status: 'PENDING',
      stripePaymentIntentId: null,
    });
    const res = await handleRewardPointPurchase(
      sessionWith({ kind: 'REWARD_POINT_PURCHASE', purchaseId: 'p1' }),
    );
    expect(res).toEqual({ ok: false, reason: 'invalid_pui_amount' });
    expect(mockTx.user.update).not.toHaveBeenCalled();
  });
});
