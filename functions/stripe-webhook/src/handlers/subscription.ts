/**
 * customer.subscription.created / updated / deleted ハンドラ
 *  - DB の subscriptions テーブルに upsert
 *  - User.stripeCustomerId が未紐付けなら customer の email から探す
 */
import type Stripe from 'stripe';
import { prisma } from '../db';
import {
  intervalFromPriceId,
  mapSubscriptionStatus,
  planFromPriceId,
} from '../plan-mapping';
import { getStripe } from '../stripe-client';

/** Stripe Subscription の period_start / period_end を安全に Date 化 */
function toDate(unix: number | null | undefined): Date | null {
  if (!unix) return null;
  return new Date(unix * 1000);
}

async function resolveUserId(
  customerId: string,
  metadataUserId?: string,
): Promise<string | null> {
  if (metadataUserId) {
    const u = await prisma.user.findUnique({ where: { id: metadataUserId } });
    if (u) return u.id;
  }
  // 1) stripeCustomerId 完全一致
  const byCustomer = await prisma.user.findUnique({
    where: { stripeCustomerId: customerId },
  });
  if (byCustomer) return byCustomer.id;

  // 2) Stripe から customer を取得して email で検索
  try {
    const stripe = await getStripe();
    const customer = await stripe.customers.retrieve(customerId);
    if (!('deleted' in customer) || customer.deleted) return null;
    if (!customer.email) return null;
    const u = await prisma.user.findUnique({ where: { email: customer.email } });
    if (!u) return null;
    // 紐付けを確定保存
    await prisma.user.update({
      where: { id: u.id },
      data: { stripeCustomerId: customerId },
    });
    return u.id;
  } catch {
    return null;
  }
}

export async function handleSubscriptionUpsert(
  sub: Stripe.Subscription,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const item = sub.items.data[0];
  if (!item) return { ok: false, reason: 'no_items' };
  const priceId = item.price.id;

  const planType = planFromPriceId(priceId) ?? 'STANDARD';
  const billingInterval = intervalFromPriceId(priceId) ?? 'MONTH';
  const status = mapSubscriptionStatus(sub.status);

  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const userId = await resolveUserId(
    customerId,
    (sub.metadata as Record<string, string> | null)?.userId,
  );
  if (!userId) {
    // eslint-disable-next-line no-console
    console.warn('[stripe-webhook] user not found for subscription', sub.id, customerId);
    return { ok: false, reason: 'user_not_found' };
  }

  // Stripe API バージョンによっては current_period_* がトップレベルに無く、
  // item レベルにある可能性があるため両対応
  const periodStart =
    toDate((sub as unknown as { current_period_start?: number }).current_period_start) ??
    toDate((item as unknown as { current_period_start?: number }).current_period_start) ??
    new Date();
  const periodEnd =
    toDate((sub as unknown as { current_period_end?: number }).current_period_end) ??
    toDate((item as unknown as { current_period_end?: number }).current_period_end) ??
    new Date();

  await prisma.subscription.upsert({
    where: { stripeSubscriptionId: sub.id },
    create: {
      userId,
      planType,
      billingInterval,
      status,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      stripePriceId: priceId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      canceledAt: toDate(sub.canceled_at),
      trialEndsAt: toDate(sub.trial_end),
    },
    update: {
      planType,
      billingInterval,
      status,
      stripePriceId: priceId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
      canceledAt: toDate(sub.canceled_at),
      trialEndsAt: toDate(sub.trial_end),
    },
  });

  return { ok: true };
}

export async function handleSubscriptionDeleted(
  sub: Stripe.Subscription,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const existing = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: sub.id },
  });
  if (!existing) {
    // 未登録なら upsert と同じ流れで CANCELED 化
    return handleSubscriptionUpsert(sub);
  }
  await prisma.subscription.update({
    where: { stripeSubscriptionId: sub.id },
    data: {
      status: 'CANCELED',
      canceledAt: toDate(sub.canceled_at) ?? new Date(),
      cancelAtPeriodEnd: false,
    },
  });
  return { ok: true };
}
