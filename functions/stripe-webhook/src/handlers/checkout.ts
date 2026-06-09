/**
 * checkout.session.completed ハンドラ
 *  - mode=subscription → 何もせず subscription.* イベントに任せる (ログのみ)
 *  - mode=payment      → metadata.orderId の Order を PAID に遷移 + Payment 行作成
 */
import type Stripe from 'stripe';
import { prisma } from '../db';

export async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (session.mode === 'subscription') {
    // Subscription はsubscription.created/updated 側で処理
    return { ok: true };
  }
  if (session.mode !== 'payment') {
    return { ok: false, reason: `unsupported_mode_${session.mode}` };
  }

  const meta = (session.metadata ?? {}) as Record<string, string | undefined>;
  const orderId = meta.orderId;
  const orderNumber = meta.orderNumber;
  const userId = meta.userId;

  if (!orderId || !userId) {
    // eslint-disable-next-line no-console
    console.warn('[stripe-webhook] checkout.session.completed missing metadata', {
      orderId,
      userId,
      sessionId: session.id,
    });
    return { ok: false, reason: 'missing_metadata' };
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return { ok: false, reason: 'order_not_found' };

  // 既に PAID 以降なら冪等で no-op
  if (order.status !== 'PENDING') {
    return { ok: true };
  }

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        paidAt: new Date(),
      },
    });
    // Payment 行を upsert (paymentIntentId がユニーク)
    if (paymentIntentId) {
      await tx.payment.upsert({
        where: { stripePaymentIntentId: paymentIntentId },
        create: {
          userId: order.userId,
          kind: 'ONE_TIME_ORDER',
          status: 'SUCCEEDED',
          amount: order.totalAmount,
          currency: order.currency,
          stripePaymentIntentId: paymentIntentId,
          orderId: order.id,
        },
        update: {
          status: 'SUCCEEDED',
          amount: order.totalAmount,
        },
      });
    }
  });

  // eslint-disable-next-line no-console
  console.log('[stripe-webhook] order paid', orderNumber ?? orderId);
  return { ok: true };
}
