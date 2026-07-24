import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireApiSession } from '@/lib/api-auth';
import { handle, errors } from '@/lib/errors';
import { getStripe } from '@/lib/stripe';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * プラン変更予約の解除 API
 *
 * change-plan で作成した「期間満了時のプラン切替予約」を取り消し、
 * 現在のプランを継続する。
 *  - Stripe Subscription Schedule を release (サブスクは通常運用に戻る)。
 *  - DB の予約カラム (scheduledPlanType / stripeScheduleId) をクリア。
 */
export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);

  const sub = await prisma.subscription.findFirst({
    where: { userId: session.user.id, status: { in: ['ACTIVE', 'TRIALING'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!sub) throw errors.notFound('アクティブなサブスクリプションがありません');

  if (!sub.scheduledPlanType && !sub.stripeScheduleId) {
    throw errors.badRequest('解除できる予約がありません');
  }

  const stripe = await getStripe();

  // Stripe 側の schedule を release する (存在しない/既に release 済みでも無視)。
  const scheduleId = sub.stripeScheduleId;
  if (scheduleId) {
    try {
      const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId);
      if (schedule.status !== 'released' && schedule.status !== 'canceled') {
        await stripe.subscriptionSchedules.release(scheduleId);
      }
    } catch (err) {
      // schedule が見つからない等は致命的でない。DB クリアは続行する。
      // eslint-disable-next-line no-console
      console.warn('[change-plan/cancel] schedule release skipped', scheduleId, err);
    }
  }

  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      scheduledPlanType: null,
      stripeScheduleId: null,
    },
  });

  await logAudit({
    userId: session.user.id,
    action: 'subscription.schedule_change.cancel',
    metadata: {
      canceledScheduledPlan: sub.scheduledPlanType,
      scheduleId,
    },
  });

  return NextResponse.json({ message: 'プラン変更の予約を解除しました' });
});
