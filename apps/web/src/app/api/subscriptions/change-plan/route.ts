import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { ChangePlanSchema, PLAN_BILLING_INTERVAL } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { handle, errors } from '@/lib/errors';
import { getStripe, getPriceId } from '@/lib/stripe';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * プラン変更 (予約) API
 *
 * 仕様:
 *  - 契約期間中は即時にプランを切り替えない (即時課金・日割りは行わない)。
 *  - 「現在の契約が満了したら次のプランへ切り替える」予約として受け付ける。
 *    実体は Stripe Subscription Schedule で、現フェーズを current_period_end で終了し、
 *    次フェーズに変更後プランの price を配置する。
 *  - すでに予約がある場合は上書き (予約の変更) する。
 *  - 変更後プランが現在のプランと同じ場合は 400。
 *
 * 満了時に Stripe が price を差し替え → customer.subscription.updated が飛び、
 * Lambda 側 webhook が planType を更新し予約カラムをクリアする。
 */
export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const body = await req.json();
  const input = ChangePlanSchema.parse(body);

  // 課金サイクルはプラン固定 (STANDARD=月額 / PREMIUM=年額)。
  // 明示指定があればそれを尊重するが、通常はプラン既定を採用する。
  const interval = input.interval ?? PLAN_BILLING_INTERVAL[input.plan] ?? 'MONTH';

  const sub = await prisma.subscription.findFirst({
    where: { userId: session.user.id, status: { in: ['ACTIVE', 'TRIALING'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!sub) throw errors.notFound('アクティブなサブスクリプションがありません');

  if (sub.planType === input.plan) {
    throw errors.badRequest('すでに同じプランをご利用中です');
  }

  const targetPriceId = await getPriceId(input.plan, interval);
  if (!targetPriceId) throw errors.badRequest('対象プランが未設定です');

  const stripe = await getStripe();
  const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
  const currentItem = stripeSub.items.data[0];
  if (!currentItem) throw errors.internal('Stripeサブスクリプション形式が不正');
  const currentPriceId = currentItem.price.id;

  // ------------------------------------------------------------------
  // Subscription Schedule を用意する。
  //   - まだスケジュール化されていなければ、既存サブスクから schedule を作成。
  //   - すでに schedule 化済み (予約変更) なら、その schedule を取得して更新。
  // ------------------------------------------------------------------
  let scheduleId = sub.stripeScheduleId ?? null;

  // Stripe 側で既に schedule が紐付いている場合はそれを優先 (DB 未保存の取りこぼし対策)。
  if (!scheduleId && stripeSub.schedule) {
    scheduleId =
      typeof stripeSub.schedule === 'string' ? stripeSub.schedule : stripeSub.schedule.id;
  }

  if (!scheduleId) {
    const created = await stripe.subscriptionSchedules.create({
      from_subscription: sub.stripeSubscriptionId,
    });
    scheduleId = created.id;
  }

  // 現在のフェーズ境界を取得する。release/更新に必要。
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
  const firstPhase = schedule.phases[0];
  if (!firstPhase) throw errors.internal('スケジュールのフェーズが取得できません');

  // フェーズ1: 現行プランを現在の期間終了まで維持。
  // フェーズ2: 期間終了後、変更後プランへ切り替え (以降このプランを継続)。
  await stripe.subscriptionSchedules.update(scheduleId, {
    end_behavior: 'release',
    phases: [
      {
        items: [{ price: currentPriceId, quantity: 1 }],
        start_date: firstPhase.start_date,
        end_date: firstPhase.end_date,
      },
      {
        items: [{ price: targetPriceId, quantity: 1 }],
        // 開始は前フェーズ終了 (= current_period_end) に自動接続。
        metadata: {
          userId: session.user.id,
          plan: input.plan,
          interval,
        },
      },
    ],
    metadata: {
      userId: session.user.id,
      scheduledPlan: input.plan,
      scheduledInterval: interval,
    },
  });

  // DB に予約状態を記録 (UI 表示用)。実際の planType 切替は満了時 webhook が行う。
  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      scheduledPlanType: input.plan,
      stripeScheduleId: scheduleId,
    },
  });

  await logAudit({
    userId: session.user.id,
    action: 'subscription.schedule_change',
    metadata: {
      fromPlan: sub.planType,
      toPlan: input.plan,
      interval,
      effectiveAt: sub.currentPeriodEnd.toISOString(),
      scheduleId,
    },
  });

  return NextResponse.json({
    message: '次回更新時のプラン変更を予約しました',
    scheduledPlan: input.plan,
    effectiveAt: sub.currentPeriodEnd.toISOString(),
  });
});
