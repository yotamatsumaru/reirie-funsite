/**
 * POST /api/me/reward-points/purchase
 *   - 特典ポイントパック (RewardPointPack) を Stripe Checkout で購入する
 *   - 確定は Stripe Webhook (/api/game/webhook, kind=REWARD_POINT_PURCHASE) で行う
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { RewardPointPurchaseInputSchema } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';
import { getStripe } from '@/lib/stripe';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const userId = session.user.id;
  const body = RewardPointPurchaseInputSchema.parse(await req.json());

  const pack = await prisma.rewardPointPack.findUnique({ where: { id: body.packId } });
  if (!pack || !pack.isActive) throw errors.notFound('ポイントパックが見つかりません');

  // 購入レコードを PENDING で作成 (スナップショット価格/ポイント数)
  const purchase = await prisma.rewardPointPurchase.create({
    data: {
      userId,
      packId: pack.id,
      points: pack.points,
      amountJpy: pack.priceJpy,
      status: 'PENDING',
    },
  });

  const stripe = getStripe();
  const checkout = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'jpy',
          product_data: { name: pack.name },
          unit_amount: pack.priceJpy,
        },
        quantity: 1,
      },
    ],
    metadata: {
      kind: 'REWARD_POINT_PURCHASE',
      purchaseId: purchase.id,
      userId,
      packId: pack.id,
    },
    success_url: body.successUrl,
    cancel_url: body.cancelUrl,
  });

  await prisma.rewardPointPurchase.update({
    where: { id: purchase.id },
    data: { stripeCheckoutSessionId: checkout.id },
  });

  return NextResponse.json({ checkoutUrl: checkout.url, sessionId: checkout.id });
});
