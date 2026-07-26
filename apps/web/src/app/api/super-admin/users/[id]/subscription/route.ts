/**
 * POST /api/super-admin/users/[id]/subscription
 *   SUPER_ADMIN 限定: 1ユーザー分のサブスクを個別に修復 / 付与する。
 *
 * ## 背景
 *   Stripe の Webhook (customer.subscription.* / invoice.*) の取りこぼしや、
 *   決済が後追い (off-session) で確定したケースでは、Stripe 上は active でも
 *   DB の Subscription が INCOMPLETE のまま取り残されることがある。
 *   全件再照合 (/reconcile) を回さなくても、この1ユーザーだけを素早く直せる
 *   ようにするのがこのエンドポイントの目的。
 *
 * ## action
 *   - 'sync'  : この顧客の Stripe 上のサブスクを取得し、DB を Stripe に合わせて upsert。
 *               (Stripe を source of truth とする / 決済成功後に押せば ACTIVE に直る)
 *   - 'grant' : Stripe を介さず DB に有料プランを手動付与する (コンプ/サポート対応)。
 *               stripeSubscriptionId は `manual_<uuid>` を採番する。
 *
 * body:
 *   { action: 'sync' }
 *   { action: 'grant', plan: 'STANDARD'|'PREMIUM', interval: 'MONTH'|'YEAR', months?: number }
 */
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import { prisma } from '@idol/db';
import { AdminUserSubscriptionActionSchema } from '@idol/shared';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import {
  getStripe,
  verifyStripeCustomer,
  planFromPriceId,
  intervalFromPriceId,
} from '@/lib/stripe';

export const runtime = 'nodejs';

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

export const POST = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireSuperAdmin();
    const { id: userId } = await ctx.params;

    const body = (await req.json().catch(() => ({}))) as unknown;
    const parsed = AdminUserSubscriptionActionSchema.safeParse(body);
    if (!parsed.success) {
      throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw errors.notFound('ユーザーが見つかりません');

    // -----------------------------------------------------------------------
    // action=grant : Stripe を介さず DB に手動付与
    // -----------------------------------------------------------------------
    if (parsed.data.action === 'grant') {
      const { plan, interval } = parsed.data;
      const months = parsed.data.months ?? (interval === 'YEAR' ? 12 : 1);
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + months);

      // 既存の「手動付与」行があれば更新、無ければ新規作成する。
      const existingManual = await prisma.subscription.findFirst({
        where: { userId, stripeSubscriptionId: { startsWith: 'manual_' } },
        orderBy: { createdAt: 'desc' },
      });

      let subId: string;
      if (existingManual) {
        await prisma.subscription.update({
          where: { id: existingManual.id },
          data: {
            planType: plan,
            billingInterval: interval,
            status: 'ACTIVE',
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
            canceledAt: null,
            scheduledPlanType: null,
            stripeScheduleId: null,
          },
        });
        subId = existingManual.id;
      } else {
        const created = await prisma.subscription.create({
          data: {
            userId,
            planType: plan,
            billingInterval: interval,
            status: 'ACTIVE',
            stripeCustomerId: user.stripeCustomerId ?? `manual_${userId}`,
            stripeSubscriptionId: `manual_${randomUUID()}`,
            stripePriceId: 'manual',
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
          },
        });
        subId = created.id;
      }

      await logAudit({
        userId: session.user.id,
        action: 'subscription.grant.manual',
        resource: `user:${userId}`,
        metadata: { plan, interval, months, subscriptionId: subId },
      });

      return NextResponse.json({
        ok: true,
        action: 'grant',
        plan,
        interval,
        currentPeriodEnd: periodEnd.toISOString(),
      });
    }

    // -----------------------------------------------------------------------
    // action=sync : この顧客の Stripe サブスクを取得して DB を Stripe に合わせる
    // -----------------------------------------------------------------------
    let stripe;
    try {
      stripe = await getStripe();
    } catch {
      throw errors.badRequest('決済機能がただいまご利用いただけません。');
    }

    // customerId の解決 (DB の値が現行モードに実在するか検証)
    const customerId = await verifyStripeCustomer(stripe, user.stripeCustomerId);
    if (!customerId) {
      throw errors.badRequest(
        'このユーザーには有効な Stripe 顧客 (stripeCustomerId) が紐づいていません。まだ一度も決済していないか、テスト/本番モードの不一致の可能性があります。',
      );
    }

    let list: Stripe.ApiList<Stripe.Subscription>;
    try {
      list = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 100,
      });
    } catch (e) {
      throw errors.badRequest(
        `Stripe からサブスクを取得できませんでした: ${(e as Error).message}`,
      );
    }

    if (list.data.length === 0) {
      throw errors.badRequest('この顧客に紐づく Stripe サブスクが見つかりませんでした。');
    }

    let created = 0;
    let updated = 0;
    const results: Array<{ stripeSubscriptionId: string; plan: string; status: SubStatus }> = [];

    for (const sub of list.data) {
      const item = sub.items.data[0];
      if (!item) continue;
      const priceId = item.price.id;
      const meta = (sub.metadata as Record<string, string> | null) ?? null;
      const planType =
        planFromMetadata(meta) ?? (await planFromPriceId(priceId)) ?? 'STANDARD';
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

    await logAudit({
      userId: session.user.id,
      action: 'subscription.sync.single',
      resource: `user:${userId}`,
      metadata: { customerId, created, updated, results },
    });

    return NextResponse.json({ ok: true, action: 'sync', created, updated, results });
  },
);
