/**
 * Stripe ⇔ DB サブスク同期の共通ロジック。
 *
 * ## 背景
 *   Stripe Webhook (`customer.subscription.*` / `invoice.*`) の取りこぼしが起きると、
 *   決済は成功しているのに DB の Subscription が作られない/更新されないままになり、
 *   会員は無条件で FREE 扱いになってしまう (packages/shared/src/schemas/subscription-health.ts 参照)。
 *
 *   これまでは SUPER_ADMIN が手動で「Stripeと同期」ボタンを押すまで直らなかった
 *   (=会員からの問い合わせを待つ必要があった)。
 *
 *   この関数は「1顧客 (Stripe customerId) 分のサブスクを Stripe から取得し、
 *   DB の Subscription を Stripe に合わせて upsert する」処理を共通化したもので、
 *   下記の複数箇所から呼び出す:
 *     - POST /api/subscriptions/sync-me         (会員本人。Checkout 完了直後の自動リカバリ)
 *     - POST /api/super-admin/users/[id]/subscription (action=sync, 個別復旧)
 *     - POST /api/super-admin/subscriptions/reconcile (全件再照合)
 */
import type Stripe from 'stripe';
import { prisma } from '@idol/db';
import { getStripe, planFromPriceId, intervalFromPriceId } from '@/lib/stripe';

export type SyncedSubStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'UNPAID'
  | 'INCOMPLETE'
  | 'INCOMPLETE_EXPIRED';

export type SyncSubscriptionsResult = {
  created: number;
  updated: number;
  results: Array<{ stripeSubscriptionId: string; plan: string; status: SyncedSubStatus }>;
};

function mapStatus(s: string): SyncedSubStatus {
  switch (s) {
    case 'trialing':
      return 'TRIALING';
    case 'active':
      return 'ACTIVE';
    case 'past_due':
      return 'PAST_DUE';
    case 'canceled':
      return 'CANCELED';
    case 'unpaid':
      return 'UNPAID';
    case 'incomplete_expired':
      return 'INCOMPLETE_EXPIRED';
    default:
      return 'INCOMPLETE';
  }
}

function toDate(unix: number | null | undefined): Date | null {
  if (!unix) return null;
  return new Date(unix * 1000);
}

function planFromMetadata(
  metadata: Record<string, string> | null | undefined,
): 'STANDARD' | 'PREMIUM' | null {
  const raw = metadata?.plan?.trim().toUpperCase();
  if (raw === 'STANDARD') return 'STANDARD';
  if (raw === 'PREMIUM') return 'PREMIUM';
  return null;
}

function intervalFromMetadata(
  metadata: Record<string, string> | null | undefined,
): 'MONTH' | 'YEAR' | null {
  const raw = metadata?.interval?.trim().toUpperCase();
  if (raw === 'MONTH' || raw === 'MONTHLY') return 'MONTH';
  if (raw === 'YEAR' || raw === 'YEARLY') return 'YEAR';
  return null;
}

/**
 * 指定した Stripe customerId に紐づく全サブスクリプションを取得し、
 * DB の Subscription テーブルを Stripe の実データに合わせて upsert する。
 *
 * Stripe を source of truth として扱うため、DB 側に古い/存在しない行があっても
 * 削除はしない (upsert のみ)。呼び出し元 (userId) は事前に customerId の持ち主として
 * 検証済みであること (verifyStripeCustomer 等)。
 */
export async function syncSubscriptionsForCustomer(
  stripe: Stripe,
  userId: string,
  customerId: string,
): Promise<SyncSubscriptionsResult> {
  const list = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100,
  });

  let created = 0;
  let updated = 0;
  const results: SyncSubscriptionsResult['results'] = [];

  for (const sub of list.data) {
    const item = sub.items.data[0];
    if (!item) continue;
    const priceId = item.price.id;
    const meta = (sub.metadata as Record<string, string> | null) ?? null;
    const planType = planFromMetadata(meta) ?? (await planFromPriceId(priceId)) ?? 'STANDARD';
    const billingInterval =
      intervalFromMetadata(meta) ?? (await intervalFromPriceId(priceId)) ?? 'MONTH';
    const status = mapStatus(sub.status);

    const periodStart =
      toDate((sub as unknown as { current_period_start?: number }).current_period_start) ??
      toDate((item as unknown as { current_period_start?: number }).current_period_start) ??
      new Date();
    const periodEnd =
      toDate((sub as unknown as { current_period_end?: number }).current_period_end) ??
      toDate((item as unknown as { current_period_end?: number }).current_period_end) ??
      new Date();

    const existing = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: sub.id },
    });

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

    if (existing) updated++;
    else created++;
    results.push({ stripeSubscriptionId: sub.id, plan: planType, status });
  }

  return { created, updated, results };
}
