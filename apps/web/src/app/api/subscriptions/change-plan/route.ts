import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { ChangePlanSchema } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { handle, errors } from '@/lib/errors';
import { getStripe, getPriceId } from '@/lib/stripe';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const body = await req.json();
  const input = ChangePlanSchema.parse(body);

  const sub = await prisma.subscription.findFirst({
    where: { userId: session.user.id, status: { in: ['ACTIVE', 'TRIALING'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!sub) throw errors.notFound('アクティブなサブスクリプションがありません');

      const priceId = await getPriceId(input.plan, input.interval);
      if (!priceId) throw errors.badRequest('対象プランが未設定です');

      const stripe = await getStripe();
  const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
  const itemId = stripeSub.items.data[0]?.id;
  if (!itemId) throw errors.internal('Stripeサブスクリプション形式が不正');

  await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    items: [{ id: itemId, price: priceId }],
    proration_behavior: 'create_prorations',
    metadata: { plan: input.plan, interval: input.interval, userId: session.user.id },
  });

  await logAudit({
    userId: session.user.id,
    action: 'subscription.change_plan',
    metadata: { plan: input.plan, interval: input.interval },
  });
  return NextResponse.json({ message: 'プラン変更を受け付けました' });
});
