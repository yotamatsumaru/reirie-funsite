/**
 * POST /api/game/purchase
 *   - 章 (GameScenario) または アイテム (GameItem) を Stripe Checkout で購入
 *   - 確定報酬型 DLC のみ (ガチャ禁止)
 *   - 成功時は webhook で PlayerInventory に追加 (本ファイルでは Checkout Session 作成のみ)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { GamePurchaseInputSchema } from '@idol/shared';
import { requireSession } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { getStripe } from '@/lib/stripe';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireSession();
  const userId = session.user.id;
  const body = GamePurchaseInputSchema.parse(await req.json());

  let amountJpy: number;
  let name: string;
  let scenarioId: string | null = null;
  let itemId: string | null = null;
  const quantity = body.quantity;

  if (body.kind === 'SCENARIO') {
    if (!body.scenarioId) throw errors.badRequest('scenarioId が必要です');
    const sc = await prisma.gameScenario.findUnique({
      where: { id: body.scenarioId },
      include: { character: { select: { name: true } } },
    });
    if (!sc || sc.status !== 'PUBLISHED') throw errors.notFound('章が見つかりません');
    if (sc.priceJpy <= 0) throw errors.badRequest('この章は無料で読めます');
    // 既に所有していないか
    const owned = await prisma.playerInventory.findUnique({
      where: { userId_scenarioId: { userId, scenarioId: sc.id } },
    });
    if (owned) throw errors.conflict('既に購入済みです');

    amountJpy = sc.priceJpy;
    name = `${sc.character.name} 第${sc.chapterNumber}章 ${sc.title}`;
    scenarioId = sc.id;
  } else if (body.kind === 'ITEM') {
    if (!body.itemId) throw errors.badRequest('itemId が必要です');
    const it = await prisma.gameItem.findUnique({ where: { id: body.itemId } });
    if (!it || !it.isActive) throw errors.notFound('アイテムが見つかりません');
    if (it.priceJpy <= 0) throw errors.badRequest('このアイテムは購入できません');
    if (it.maxOwn) {
      const inv = await prisma.playerInventory.findUnique({
        where: { userId_itemId: { userId, itemId: it.id } },
      });
      if (inv && inv.quantity + quantity > it.maxOwn) {
        throw errors.conflict(`所持上限 (${it.maxOwn}) を超えています`);
      }
    }
    amountJpy = it.priceJpy * quantity;
    name = `${it.name} × ${quantity}`;
    itemId = it.id;
  } else {
    throw errors.badRequest('kind が不正です');
  }

  // 購入レコードを PENDING で作成
  const purchase = await prisma.playerPurchase.create({
    data: {
      userId,
      kind: body.kind,
      scenarioId,
      itemId,
      quantity,
      amountJpy,
      paymentStatus: 'PENDING',
    },
  });

  // Stripe Checkout
  const stripe = getStripe();
  const checkout = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'jpy',
          product_data: { name },
          unit_amount: body.kind === 'ITEM' ? amountJpy / quantity : amountJpy,
        },
        quantity: body.kind === 'ITEM' ? quantity : 1,
      },
    ],
    metadata: {
      kind: 'GAME_PURCHASE',
      purchaseId: purchase.id,
      userId,
      scenarioId: scenarioId ?? '',
      itemId: itemId ?? '',
      quantity: String(quantity),
    },
    success_url: body.successUrl,
    cancel_url: body.cancelUrl,
  });

  await prisma.playerPurchase.update({
    where: { id: purchase.id },
    data: { stripeCheckoutSessionId: checkout.id },
  });

  return NextResponse.json({ checkoutUrl: checkout.url, sessionId: checkout.id });
});
