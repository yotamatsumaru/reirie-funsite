/**
 * POST /api/game/webhook
 *   - Pui パック購入確定時に Pui を付与 (kind=REWARD_POINT_PURCHASE)
 *   - RewardPointPurchase を SUCCEEDED に更新
 *
 * Stripe Dashboard で `checkout.session.completed` イベントを購読する
 *
 * 【URL について】
 * パスに "game" が付いているのは、もともと恋愛 ADV の章 / アイテム課金 (kind=GAME_PURCHASE)
 * と同居していた名残。恋愛 ADV は提供終了したが、Stripe Dashboard にこの URL で
 * 登録済みのため、Pui パック購入の確定処理を壊さないようパスはそのまま残している。
 * (URL を変える場合は Stripe Dashboard の Webhook エンドポイントも同時に変更すること)
 *
 * kind=GAME_PURCHASE (恋愛 ADV) のイベントが届いた場合は何もせず受信だけ返す。
 *
 * 【重要 / ゲーム公開設定の対象外】
 * ここには requireGameSectionVisible を入れてはならない。この webhook は
 * 「すでに決済が完了した」通知であり、公開設定を理由に 404 を返すと
 * 「課金されたのに商品が付与されない」状態になる。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { getStripe, getStripeWebhookSecret } from '@/lib/stripe';
import { grantPuiFromStripePurchase } from '@/lib/points';
import type Stripe from 'stripe';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const sig = req.headers.get('stripe-signature');
  if (!sig) return new NextResponse('missing signature', { status: 400 });

  const webhookSecret = await getStripeWebhookSecret();
  if (!webhookSecret) {
    return new NextResponse('webhook secret not configured', { status: 500 });
  }

  const stripe = await getStripe();
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
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

    if (meta.kind === 'REWARD_POINT_PURCHASE') {
      const purchaseId = meta.purchaseId;
      if (!purchaseId) return NextResponse.json({ received: true, error: 'missing metadata' });
      await grantPuiFromStripePurchase(purchaseId, {
        stripePaymentIntentId:
          typeof session.payment_intent === 'string' ? session.payment_intent : null,
      });
      return NextResponse.json({ received: true });
    }

    // 恋愛 ADV (kind=GAME_PURCHASE) は提供終了。その他の kind も含め、
    // ここで扱わないイベントは受信だけ返す (Stripe に再送させない)。
    return NextResponse.json({ received: true, ignored: true });
  }

  return NextResponse.json({ received: true });
}
