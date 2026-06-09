/**
 * POST /api/game/webhook
 *   - Stripe Checkout 完了時に PlayerInventory に章/アイテムを付与
 *   - PlayerPurchase を SUCCEEDED に更新
 *
 * Stripe Dashboard で `checkout.session.completed` イベントを購読する
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { getStripe } from '@/lib/stripe';
import { env } from '@/lib/env';
import type Stripe from 'stripe';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const sig = req.headers.get('stripe-signature');
  if (!sig) return new NextResponse('missing signature', { status: 400 });
  if (!env.stripe.webhookSecret) {
    return new NextResponse('webhook secret not configured', { status: 500 });
  }

  const stripe = getStripe();
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, env.stripe.webhookSecret);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[game/webhook] signature verify failed', err);
    return new NextResponse('invalid signature', { status: 400 });
  }

  // 重複処理防止
  const existing = await prisma.stripeWebhookEvent.findUnique({ where: { id: event.id } });
  if (existing) return NextResponse.json({ received: true, duplicated: true });
  await prisma.stripeWebhookEvent.create({
    data: { id: event.id, type: event.type, payload: event as never },
  });

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const meta = session.metadata ?? {};
    if (meta.kind !== 'GAME_PURCHASE') {
      return NextResponse.json({ received: true, ignored: true });
    }
    const purchaseId = meta.purchaseId;
    const userId = meta.userId;
    const scenarioId = meta.scenarioId || null;
    const itemId = meta.itemId || null;
    const quantity = Number(meta.quantity ?? '1');

    if (!purchaseId || !userId) {
      return NextResponse.json({ received: true, error: 'missing metadata' });
    }

    await prisma.$transaction(async (tx) => {
      const purchase = await tx.playerPurchase.findUnique({ where: { id: purchaseId } });
      if (!purchase) return;
      if (purchase.paymentStatus === 'SUCCEEDED') return; // 二重防止

      await tx.playerPurchase.update({
        where: { id: purchase.id },
        data: {
          paymentStatus: 'SUCCEEDED',
          paidAt: new Date(),
          stripePaymentIntentId:
            typeof session.payment_intent === 'string' ? session.payment_intent : null,
        },
      });

      if (scenarioId) {
        await tx.playerInventory.upsert({
          where: { userId_scenarioId: { userId, scenarioId } },
          create: { userId, scenarioId, quantity: 1 },
          update: {},
        });
      }
      if (itemId) {
        const inv = await tx.playerInventory.findUnique({
          where: { userId_itemId: { userId, itemId } },
        });
        if (inv) {
          await tx.playerInventory.update({
            where: { id: inv.id },
            data: { quantity: inv.quantity + quantity },
          });
        } else {
          await tx.playerInventory.create({
            data: { userId, itemId, quantity },
          });
        }
      }
    });
  }

  return NextResponse.json({ received: true });
}
