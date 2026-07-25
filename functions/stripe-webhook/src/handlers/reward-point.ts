/**
 * Pui パック購入 (RewardPointPurchase) 確定ハンドラ
 *
 * checkout.session.completed の metadata.kind === 'REWARD_POINT_PURCHASE' で呼ばれる。
 *
 * 本番の Stripe Webhook エンドポイントは Lambda Function URL のみのため、
 * Pui パック購入の確定・付与もこの Lambda 側で行う必要がある。
 * (アプリ側 /api/game/webhook の grantPuiFromStripePurchase と同一ロジックを踏襲)
 *
 * 冪等性:
 *  - RewardPointPurchase.status === 'SUCCEEDED' の場合は no-op (二重付与防止)。
 *  - User.pui は increment による原子的更新。
 *  - 履歴 (PuiTransaction) 作成 + 残高加算 + purchase 更新を単一トランザクションで実行。
 */
import type Stripe from 'stripe';
import { prisma } from '../db';

/** 1 取引で動かせる Pui の絶対値上限 (アプリ側 MAX_PUI_PER_TX と一致させる防御的上限) */
const MAX_PUI_PER_TX = 1_000_000;

export async function handleRewardPointPurchase(
  session: Stripe.Checkout.Session,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const meta = (session.metadata ?? {}) as Record<string, string | undefined>;
  const purchaseId = meta.purchaseId;

  if (!purchaseId) {
    // eslint-disable-next-line no-console
    console.warn('[stripe-webhook] REWARD_POINT_PURCHASE missing purchaseId', {
      sessionId: session.id,
    });
    return { ok: false, reason: 'missing_metadata' };
  }

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const purchase = await tx.rewardPointPurchase.findUnique({
        where: { id: purchaseId },
      });
      if (!purchase) return { ok: false as const, reason: 'purchase_not_found' };
      // 既に確定済みなら冪等 no-op
      if (purchase.status === 'SUCCEEDED') {
        return { ok: true as const };
      }

      // 防御的検証: 付与額は正の整数かつ上限以内
      if (
        !Number.isInteger(purchase.pui) ||
        purchase.pui <= 0 ||
        purchase.pui > MAX_PUI_PER_TX
      ) {
        return { ok: false as const, reason: 'invalid_pui_amount' };
      }

      await tx.rewardPointPurchase.update({
        where: { id: purchase.id },
        data: {
          status: 'SUCCEEDED',
          paidAt: new Date(),
          stripePaymentIntentId: paymentIntentId ?? purchase.stripePaymentIntentId,
        },
      });

      // User.pui を原子的に加算 (cluster 並列でも競合しない)
      const user = await tx.user.update({
        where: { id: purchase.userId },
        data: { pui: { increment: purchase.pui } },
        select: { pui: true },
      });

      // 監査用スナップショット付き履歴
      await tx.puiTransaction.create({
        data: {
          userId: purchase.userId,
          amount: purchase.pui,
          balance: user.pui,
          reason: 'STRIPE_PURCHASE',
          note: `Pui パック購入 (${purchase.pui} Pui / ¥${purchase.amountJpy.toLocaleString()})`,
        },
      });

      return { ok: true as const };
    });

    if (result.ok) {
      // eslint-disable-next-line no-console
      console.log('[stripe-webhook] pui pack granted', purchaseId);
    } else {
      // eslint-disable-next-line no-console
      console.warn('[stripe-webhook] pui pack not granted', purchaseId, result.reason);
    }
    return result;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[stripe-webhook] reward point purchase failed', purchaseId, err);
    // 5xx を返してもらうため throw (Stripe が自動リトライする)
    throw err;
  }
}
