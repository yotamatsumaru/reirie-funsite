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
import { prisma } from '@idol/db';
import { AdminUserSubscriptionActionSchema } from '@idol/shared';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getStripe, verifyStripeCustomer } from '@/lib/stripe';
import { syncSubscriptionsForCustomer } from '@/lib/subscription-sync';

export const runtime = 'nodejs';

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

    let result: Awaited<ReturnType<typeof syncSubscriptionsForCustomer>>;
    try {
      result = await syncSubscriptionsForCustomer(stripe, userId, customerId);
    } catch (e) {
      throw errors.badRequest(
        `Stripe からサブスクを取得できませんでした: ${(e as Error).message}`,
      );
    }

    if (result.results.length === 0) {
      throw errors.badRequest('この顧客に紐づく Stripe サブスクが見つかりませんでした。');
    }

    await logAudit({
      userId: session.user.id,
      action: 'subscription.sync.single',
      resource: `user:${userId}`,
      metadata: { customerId, ...result },
    });

    return NextResponse.json({ ok: true, action: 'sync', ...result });
  },
);
