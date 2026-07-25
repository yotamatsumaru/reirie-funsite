/**
 * POST /api/super-admin/subscriptions/reconcile
 *   Stripe 上の実際のサブスクリプションと DB の Subscription テーブルを再照合する。
 *
 * ## 背景
 *   Stripe Webhook の設定で `customer.subscription.*` イベントが購読されていない、
 *   または一時的に取りこぼした場合、`invoice.paid` による売上 (Payment) だけが記録され、
 *   サブスク分析 (Subscription テーブル) には行が作られず両者が乖離する。
 *   本エンドポイントは Stripe を正 (source of truth) として、DB の Subscription を
 *   まとめて upsert し、取りこぼしを一括で復旧する。
 *
 * ## 挙動
 *   - Stripe から全サブスクリプション (status=all) をページングで取得
 *   - 各サブスクの price / status / 期間を内部モデルにマッピング
 *   - customer(email/customerId) からユーザーを解決して upsert
 *   - ユーザーが解決できなかったものは skipped として報告
 *   - 破壊的な削除は行わない (既存行の status は Stripe に合わせて更新するのみ)
 *
 * SUPER_ADMIN 限定。実行は監査ログに記録する。
 */
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { errorResponse } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getStripe, planFromPriceId, intervalFromPriceId } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PlanType = 'STANDARD' | 'PREMIUM';
type BillingInterval = 'MONTH' | 'YEAR';
type SubStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'UNPAID'
  | 'INCOMPLETE'
  | 'INCOMPLETE_EXPIRED';

function mapStatus(s: string): SubStatus {
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

/**
 * Checkout 時に付与された metadata.plan からプランを判定する。
 * Price ID マッピングより優先することで、本番 Price ID の設定ミスで
 * PREMIUM 申込が STANDARD に誤登録された既存行もここで正しく修復できる。
 */
function planFromMetadata(
  metadata: Record<string, string> | null | undefined,
): PlanType | null {
  const raw = metadata?.plan?.trim().toUpperCase();
  if (raw === 'STANDARD') return 'STANDARD';
  if (raw === 'PREMIUM') return 'PREMIUM';
  return null;
}

function intervalFromMetadata(
  metadata: Record<string, string> | null | undefined,
): BillingInterval | null {
  const raw = metadata?.interval?.trim().toUpperCase();
  if (raw === 'MONTH' || raw === 'MONTHLY') return 'MONTH';
  if (raw === 'YEAR' || raw === 'YEARLY') return 'YEAR';
  return null;
}

/** Stripe Subscription から customer email を取り出す (展開済み前提) */
function customerEmail(sub: Stripe.Subscription): string | null {
  const c = sub.customer;
  if (typeof c === 'string') return null;
  if ('deleted' in c && c.deleted) return null;
  return (c as Stripe.Customer).email ?? null;
}

function customerId(sub: Stripe.Subscription): string {
  return typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
}

/** metadata.userId → stripeCustomerId → customer.email の順でユーザーを解決 */
async function resolveUserId(sub: Stripe.Subscription): Promise<string | null> {
  const metaUserId = (sub.metadata as Record<string, string> | null)?.userId;
  if (metaUserId) {
    const u = await prisma.user.findUnique({ where: { id: metaUserId } });
    if (u) return u.id;
  }
  const cid = customerId(sub);
  const byCustomer = await prisma.user.findUnique({
    where: { stripeCustomerId: cid },
  });
  if (byCustomer) return byCustomer.id;

  const email = customerEmail(sub);
  if (email) {
    const u = await prisma.user.findUnique({ where: { email } });
    if (u) {
      // 紐付けを確定保存
      await prisma.user.update({
        where: { id: u.id },
        data: { stripeCustomerId: cid },
      });
      return u.id;
    }
  }
  return null;
}

export async function POST(): Promise<NextResponse> {
  try {
    const session = await requireSuperAdmin();
    const stripe = await getStripe();

    let created = 0;
    let updated = 0;
    let skippedNoUser = 0;
    let skippedNoPrice = 0;
    let processed = 0;
    const skippedDetails: Array<{ subscriptionId: string; reason: string; email: string | null }> =
      [];

    // Stripe から全サブスクをページングで取得 (customer を展開して email を得る)
    let startingAfter: string | undefined = undefined;
    // 安全のための上限 (無限ループ防止 / 100件 x 50ページ = 5000件)
    const MAX_PAGES = 50;
    for (let page = 0; page < MAX_PAGES; page++) {
      const list: Stripe.ApiList<Stripe.Subscription> = await stripe.subscriptions.list({
        status: 'all',
        limit: 100,
        expand: ['data.customer'],
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      for (const sub of list.data) {
        processed++;
        const item = sub.items.data[0];
        if (!item) {
          skippedNoPrice++;
          skippedDetails.push({ subscriptionId: sub.id, reason: 'no_items', email: null });
          continue;
        }
        const priceId = item.price.id;
        // metadata.plan / interval を最優先 (Price ID 設定ミスの誤登録も修復)。
        // 次に Price ID マッピング、最後に fallback。
        const meta = (sub.metadata as Record<string, string> | null) ?? null;
        const planType: PlanType =
          planFromMetadata(meta) ?? (await planFromPriceId(priceId)) ?? 'STANDARD';
        const billingInterval: BillingInterval =
          intervalFromMetadata(meta) ?? (await intervalFromPriceId(priceId)) ?? 'MONTH';
        const status = mapStatus(sub.status);

        const userId = await resolveUserId(sub);
        if (!userId) {
          skippedNoUser++;
          skippedDetails.push({
            subscriptionId: sub.id,
            reason: 'user_not_found',
            email: customerEmail(sub),
          });
          continue;
        }

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
            stripeCustomerId: customerId(sub),
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
      }

      if (!list.has_more || list.data.length === 0) break;
      startingAfter = list.data[list.data.length - 1]?.id;
    }

    await logAudit({
      userId: session.user.id,
      action: 'subscription.reconcile',
      resource: 'subscriptions',
      metadata: { processed, created, updated, skippedNoUser, skippedNoPrice },
    });

    return NextResponse.json({
      ok: true,
      processed,
      created,
      updated,
      skippedNoUser,
      skippedNoPrice,
      // 詳細は最大 50 件までに制限 (レスポンス肥大防止)
      skipped: skippedDetails.slice(0, 50),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
