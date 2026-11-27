import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { CancelSubscriptionSchema } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { handle, errors } from '@/lib/errors';
import { getStripe } from '@/lib/stripe';
import { logAudit } from '@/lib/audit';
import { isManualSubscription, liveSubscriptionWhere } from '@/lib/subscription-status';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const input = CancelSubscriptionSchema.parse({
    cancelAtPeriodEnd: body.cancelAtPeriodEnd ?? true,
  });

  const sub = await prisma.subscription.findFirst({
    where: { userId: session.user.id, ...liveSubscriptionWhere() },
    orderBy: { createdAt: 'desc' },
  });
  if (!sub) throw errors.notFound();
  // 手動付与 (Stripe を通っていない契約) は Stripe で解約できない。運営に依頼してもらう
  if (isManualSubscription(sub.stripeSubscriptionId)) {
    throw errors.badRequest('この契約は運営が付与したものです。解約はお問い合わせからご依頼ください');
  }

  const stripe = await getStripe();
  if (input.cancelAtPeriodEnd) {
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  } else {
    await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
  }
  await logAudit({
    userId: session.user.id,
    action: 'subscription.cancel',
    metadata: { cancelAtPeriodEnd: input.cancelAtPeriodEnd },
  });
  return NextResponse.json({ message: '解約処理を受け付けました' });
});
