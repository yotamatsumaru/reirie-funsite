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
  type PlanType,
  type PriceMap,
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
  prices?: PriceMap,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const item = sub.items.data[0];
  if (!item) return { ok: false, reason: 'no_items' };
  const priceId = item.price.id;

  const planType = planFromPriceId(priceId, prices) ?? 'STANDARD';
  const billingInterval = intervalFromPriceId(priceId, prices) ?? 'MONTH';
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

  // ------------------------------------------------------------------
  // プラン変更予約 (Subscription Schedule) の同期
  //   - Stripe 側でスケジュールが release / 解除された、または既存の予約プランへ
  //     実際に切り替わった場合は、DB の予約カラムをクリアする。
  //   - まだスケジュールが有効 (別プランへ切替待ち) の場合は予約情報を保持する。
  // ------------------------------------------------------------------
  const existing = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: sub.id },
  });

  const scheduleRef = (sub as unknown as { schedule?: string | { id: string } | null }).schedule;
  const currentScheduleId =
    typeof scheduleRef === 'string' ? scheduleRef : (scheduleRef?.id ?? null);

  // 予約カラムの決定
  //   1) 実際の planType が予約プランに一致 → 切替完了なのでクリア
  //   2) Stripe 側に schedule が無い (release 済み) → クリア
  //   3) それ以外 → 既存の予約を維持
  // DB の scheduledPlanType は Prisma enum (FREE も含む) だが、予約対象は
  // 有料プランのみのため PlanType (STANDARD|PREMIUM) として扱う。
  let scheduledPlanType: PlanType | null =
    existing?.scheduledPlanType === 'STANDARD' || existing?.scheduledPlanType === 'PREMIUM'
      ? existing.scheduledPlanType
      : null;
  let stripeScheduleId: string | null = existing?.stripeScheduleId ?? null;

  if (scheduledPlanType && scheduledPlanType === planType) {
    // 予約先プランに到達 → 予約完了
    scheduledPlanType = null;
    stripeScheduleId = null;
  } else if (!currentScheduleId) {
    // Stripe 側にスケジュールが無い (未使用 or release 済み) → 予約解除
    scheduledPlanType = null;
    stripeScheduleId = null;
  } else {
    // スケジュール継続中: 最新の schedule id を反映しつつ予約を維持
    stripeScheduleId = currentScheduleId;
  }

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
      scheduledPlanType,
      stripeScheduleId,
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
      scheduledPlanType,
      stripeScheduleId,
    },
  });

  return { ok: true };
}

export async function handleSubscriptionDeleted(
  sub: Stripe.Subscription,
  prices?: PriceMap,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const existing = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: sub.id },
  });
  if (!existing) {
    // 未登録なら upsert と同じ流れで CANCELED 化
    return handleSubscriptionUpsert(sub, prices);
  }
  await prisma.subscription.update({
    where: { stripeSubscriptionId: sub.id },
    data: {
      status: 'CANCELED',
      canceledAt: toDate(sub.canceled_at) ?? new Date(),
      cancelAtPeriodEnd: false,
      // 解約時は保留中のプラン変更予約も無効化する
      scheduledPlanType: null,
      stripeScheduleId: null,
    },
  });
  return { ok: true };
}
