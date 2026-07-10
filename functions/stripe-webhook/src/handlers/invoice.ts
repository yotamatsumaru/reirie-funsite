/**
 * invoice.payment_succeeded / invoice.payment_failed ハンドラ
 *  - サブスク継続課金時の決済記録を Payment テーブルに残す
 *  - 失敗時は Subscription 側の status は subscription.updated で来るのでここでは触らない
 */
import type Stripe from 'stripe';
import { prisma } from '../db';

function toDate(unix: number | null | undefined): Date | null {
  if (!unix) return null;
  return new Date(unix * 1000);
}

export async function handleInvoicePaid(
  invoice: Stripe.Invoice,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!invoice.id) return { ok: false, reason: 'no_invoice_id' };

  // subscription_id の取得 (Stripe API バージョン差異を吸収)
  const subId = (invoice as unknown as { subscription?: string | { id: string } }).subscription;
  const subscriptionId = typeof subId === 'string' ? subId : subId?.id;

  let subscriptionRecordId: string | null = null;
  let userId: string | null = null;

  if (subscriptionId) {
    const sub = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
    });
    if (sub) {
      subscriptionRecordId = sub.id;
      userId = sub.userId;
    }
  }

  // userId が解決できない場合は customer email から救済
  if (!userId) {
    const customerId =
      typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer?.id ?? null;
    if (customerId) {
      const u = await prisma.user.findUnique({ where: { stripeCustomerId: customerId } });
      if (u) userId = u.id;
    }
  }

  if (!userId) {
    // eslint-disable-next-line no-console
    console.warn('[stripe-webhook] invoice.paid user not found', invoice.id);
    return { ok: false, reason: 'user_not_found' };
  }

  // payment_intent / charge の解決
  // 注: stripe-node v22 (Dahlia API 型) では Invoice.payment_intent が型定義上
  // 削除されているが、pin している apiVersion ('2024-10-28.acacia') では
  // 実データとしては引き続き返ってくるため、他フィールドと同様に unknown 経由で吸収する。
  const invoicePaymentIntent = (
    invoice as unknown as { payment_intent?: string | { id: string } }
  ).payment_intent;
  const paymentIntentId =
    typeof invoicePaymentIntent === 'string'
      ? invoicePaymentIntent
      : (invoicePaymentIntent?.id ?? null);
  const chargeId =
    typeof (invoice as unknown as { charge?: string | { id: string } }).charge === 'string'
      ? ((invoice as unknown as { charge: string }).charge)
      : ((invoice as unknown as { charge?: { id: string } }).charge?.id ?? null);

  // upsert: stripeInvoiceId or stripePaymentIntentId
  await prisma.payment.upsert({
    where: { stripeInvoiceId: invoice.id },
    create: {
      userId,
      kind: 'SUBSCRIPTION',
      status: 'SUCCEEDED',
      amount: invoice.amount_paid ?? invoice.total ?? 0,
      currency: (invoice.currency ?? 'jpy').toUpperCase(),
      stripeInvoiceId: invoice.id,
      stripePaymentIntentId: paymentIntentId,
      stripeChargeId: chargeId,
      receiptUrl: invoice.hosted_invoice_url,
      subscriptionId: subscriptionRecordId,
    },
    update: {
      status: 'SUCCEEDED',
      amount: invoice.amount_paid ?? invoice.total ?? 0,
      stripePaymentIntentId: paymentIntentId,
      stripeChargeId: chargeId,
      receiptUrl: invoice.hosted_invoice_url,
    },
  });

  // 期間更新 (Subscription の period_end が来ているはずだが invoice 側でも反映)
  if (subscriptionRecordId) {
    const lineItem = invoice.lines?.data?.[0];
    const period = lineItem?.period;
    if (period?.start && period?.end) {
      await prisma.subscription.update({
        where: { id: subscriptionRecordId },
        data: {
          currentPeriodStart: toDate(period.start) ?? undefined,
          currentPeriodEnd: toDate(period.end) ?? undefined,
        },
      });
    }
  }

  return { ok: true };
}

export async function handleInvoiceFailed(
  invoice: Stripe.Invoice,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!invoice.id) return { ok: false, reason: 'no_invoice_id' };

  const subId = (invoice as unknown as { subscription?: string | { id: string } }).subscription;
  const subscriptionId = typeof subId === 'string' ? subId : subId?.id;
  let subscriptionRecordId: string | null = null;
  let userId: string | null = null;

  if (subscriptionId) {
    const sub = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
    });
    if (sub) {
      subscriptionRecordId = sub.id;
      userId = sub.userId;
    }
  }
  if (!userId) {
    const customerId =
      typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer?.id ?? null;
    if (customerId) {
      const u = await prisma.user.findUnique({ where: { stripeCustomerId: customerId } });
      if (u) userId = u.id;
    }
  }
  if (!userId) {
    // eslint-disable-next-line no-console
    console.warn('[stripe-webhook] invoice.failed user not found', invoice.id);
    return { ok: false, reason: 'user_not_found' };
  }

  await prisma.payment.upsert({
    where: { stripeInvoiceId: invoice.id },
    create: {
      userId,
      kind: 'SUBSCRIPTION',
      status: 'FAILED',
      amount: invoice.amount_due ?? invoice.total ?? 0,
      currency: (invoice.currency ?? 'jpy').toUpperCase(),
      stripeInvoiceId: invoice.id,
      failureReason: 'invoice_payment_failed',
      subscriptionId: subscriptionRecordId,
    },
    update: {
      status: 'FAILED',
      failureReason: 'invoice_payment_failed',
    },
  });
  return { ok: true };
}
