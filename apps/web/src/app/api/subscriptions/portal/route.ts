import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireSession } from '@/auth';
import { handle, errors } from '@/lib/errors';
import { getStripe } from '@/lib/stripe';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireSession();
  const body = (await req.json().catch(() => ({}))) as { returnUrl?: string };

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.stripeCustomerId) throw errors.notFound('Stripe顧客が見つかりません');

  const stripe = getStripe();
  const portal = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: body.returnUrl ?? `${env.appBaseUrl}/me`,
    locale: 'ja',
  });
  return NextResponse.json({ url: portal.url });
});
