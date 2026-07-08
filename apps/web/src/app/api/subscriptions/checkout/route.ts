import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { CreateCheckoutSessionSchema } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { handle, errors } from '@/lib/errors';
import { getStripe, getPriceId } from '@/lib/stripe';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const body = await req.json();
  const input = CreateCheckoutSessionSchema.parse(body);

  const priceId = getPriceId(input.plan, input.interval);
  if (!priceId) {
    throw errors.badRequest(`Stripe Price ID が未設定です: ${input.plan} / ${input.interval}`);
  }

  const stripe = getStripe();

  // 既存の Customer を再利用 (1ユーザー1顧客)
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) throw errors.notFound();

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.displayName ?? undefined,
      metadata: { userId: user.id },
    });
    customerId = customer.id;
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const checkout = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    locale: 'ja',
    allow_promotion_codes: true,
    metadata: { userId: user.id, plan: input.plan, interval: input.interval },
    subscription_data: {
      metadata: { userId: user.id, plan: input.plan, interval: input.interval },
    },
  });

  await logAudit({
    userId: user.id,
    action: 'subscription.checkout.create',
    metadata: { plan: input.plan, interval: input.interval, sessionId: checkout.id },
  });

  return NextResponse.json({ sessionId: checkout.id, url: checkout.url });
});
