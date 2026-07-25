/**
 * invoice.payment_succeeded / invoice.payment_failed ハンドラ
 *  - サブスク継続課金時の決済記録を Payment テーブルに残す
 *  - 失敗時は Subscription 側の status は subscription.updated で来るのでここでは触らない
 *
 * ## Subscription テーブルの自動バックフィル (重要)
 *   Stripe の Webhook 設定で `customer.subscription.*` が購読されていない、
 *   または一時的に取りこぼした場合、Payment (売上) は記録されるのに
 *   Subscription (サブスク分析) には行が作られず、両者が乖離する。
 *   これを防ぐため、invoice.paid 時に対応する Subscription 行が見つからなければ
 *   Stripe から subscription を取得して upsert する。
 */
import type Stripe from 'stripe';
import { prisma } from '../db';
import { getStripe } from '../stripe-client';
import { handleSubscriptionUpsert } from './subscription';
import { resolveStripeRuntime } from '../secrets';

function toDate(unix: number | null | undefined): Date | null {
  if (!unix) return null;
  return new Date(unix * 1000);
}

/**
 * stripeSubscriptionId に対応する Subscription 行が無ければ、
 * Stripe から subscription を取得して handleSubscriptionUpsert でバックフィルする。
 * 成功すれば作成済みの Subscription.id を返す。
 */
async function ensureSubscriptionRecord(
  subscriptionId: string,
): Promise<string | null> {
  const existing = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
  });
  if (existing) return existing.id;

  try {
    const stripe = await getStripe();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    // TEST/LIVE いずれのモードかで Price ID マップが変わるため runtime を解決して渡す
    const runtime = await resolveStripeRuntime();
    const result = await handleSubscriptionUpsert(sub, runtime.prices);
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        '[stripe-webhook] invoice backfill subscription failed',
        subscriptionId,
        result.reason,
      );
      return null;
    }
    const created = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
    });
    return created?.id ?? null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[stripe-webhook] invoice backfill subscription error',
      subscriptionId,
      (err as Error).message,
    );
    return null;
  }
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
    } else {
      // Subscription 行が無い (customer.subscription.* 取りこぼし等) → Stripe から復元
      const backfilledId = await ensureSubscriptionRecord(subscriptionId);
      if (backfilledId) {
        const created = await prisma.subscription.findUnique({
          where: { id: backfilledId },
        });
        if (created) {
          subscriptionRecordId = created.id;
          userId = created.userId;
        }
      }
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

  // userId は解決できたが Subscription 行に結び付けられなかった場合、
  // Payment.subscriptionId が null で保存され、管理画面の返金一覧
  // (subscriptionId 完全一致検索) に載らなくなる。運用で気付けるよう警告を残す。
  // (super-admin の返金 API 側で Stripe を真実として後追い backfill する)
  if (subscriptionId && !subscriptionRecordId) {
    // eslint-disable-next-line no-console
    console.warn(
      '[stripe-webhook] invoice.paid subscription row unresolved; payment saved without subscriptionId',
      { invoiceId: invoice.id, stripeSubscriptionId: subscriptionId },
    );
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
