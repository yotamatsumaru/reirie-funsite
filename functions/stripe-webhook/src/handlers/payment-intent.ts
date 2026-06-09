/**
 * payment_intent.succeeded / payment_intent.payment_failed ハンドラ
 *
 * checkout.session.completed が先に来る想定だが、
 * Webhook 配信順序は保証されないので冪等処理として実装。
 *  - metadata.orderId があれば Order を PAID 化 (PENDING のときのみ)
 *  - Payment 行を upsert
 */
import type Stripe from 'stripe';
import { prisma } from '../db';

export async function handlePaymentIntentSucceeded(
  pi: Stripe.PaymentIntent,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const meta = (pi.metadata ?? {}) as Record<string, string | undefined>;
  const orderId = meta.orderId;
  const userId = meta.userId;

  // サブスク (invoice 経由) の payment_intent はここでは何もしない
  if (meta.kind && meta.kind !== 'ONE_TIME_ORDER') {
    return { ok: true };
  }

  if (!orderId || !userId) {
    return { ok: true }; // Subscription 等は invoice 側で処理されるので no-op
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return { ok: false, reason: 'order_not_found' };

  await prisma.$transaction(async (tx) => {
    if (order.status === 'PENDING') {
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'PAID', paidAt: new Date() },
      });
    }
    await tx.payment.upsert({
      where: { stripePaymentIntentId: pi.id },
      create: {
        userId: order.userId,
        kind: 'ONE_TIME_ORDER',
        status: 'SUCCEEDED',
        amount: pi.amount_received ?? pi.amount,
        currency: pi.currency.toUpperCase(),
        stripePaymentIntentId: pi.id,
        stripeChargeId:
          typeof (pi as unknown as { latest_charge?: string | { id: string } }).latest_charge ===
          'string'
            ? ((pi as unknown as { latest_charge: string }).latest_charge)
            : ((pi as unknown as { latest_charge?: { id: string } }).latest_charge?.id ?? null),
        orderId: order.id,
      },
      update: {
        status: 'SUCCEEDED',
        amount: pi.amount_received ?? pi.amount,
      },
    });
  });

  return { ok: true };
}

export async function handlePaymentIntentFailed(
  pi: Stripe.PaymentIntent,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const meta = (pi.metadata ?? {}) as Record<string, string | undefined>;
  const orderId = meta.orderId;
  if (!orderId) return { ok: true }; // EC 注文以外は invoice 側で扱う

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return { ok: false, reason: 'order_not_found' };

  await prisma.payment.upsert({
    where: { stripePaymentIntentId: pi.id },
    create: {
      userId: order.userId,
      kind: 'ONE_TIME_ORDER',
      status: 'FAILED',
      amount: pi.amount,
      currency: pi.currency.toUpperCase(),
      stripePaymentIntentId: pi.id,
      failureReason: pi.last_payment_error?.message ?? 'payment_intent_failed',
      orderId: order.id,
    },
    update: {
      status: 'FAILED',
      failureReason: pi.last_payment_error?.message ?? 'payment_intent_failed',
    },
  });

  // 注文ステータスは PENDING のままにしておき、ユーザーに再決済の機会を残す
  // 在庫の reserved 解放は Cron / 明示的キャンセルで行う想定
  return { ok: true };
}
