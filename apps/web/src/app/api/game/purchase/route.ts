/**
 * POST /api/game/purchase
 *   - 章 (GameScenario) または アイテム (GameItem) を購入する
 *   - 決済手段は Stripe (課金) または Fan ポイント (payMethod で指定)
 *     - STRIPE: Checkout Session を作成して返す。確定は webhook (kind=GAME_PURCHASE) で行う。
 *     - FAN_POINT: サーバー側で即時に Fan ポイントを消費し、PlayerInventory に確定付与する。
 *   - 確定報酬型 DLC のみ (ガチャ禁止)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { GamePurchaseInputSchema } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';
import { getStripe } from '@/lib/stripe';
import { purchaseScenarioWithFanPoints, purchaseItemWithFanPoints } from '@/lib/points';

export const runtime = 'nodejs';

const FAN_POINT_ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: '対象が見つかりません',
  NOT_FOR_SALE: 'Fan ポイントでは購入できません',
  ALREADY_OWNED: '既に購入済みです',
  OWN_LIMIT_EXCEEDED: '所持上限を超えています',
};

export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const userId = session.user.id;
  const body = GamePurchaseInputSchema.parse(await req.json());
  const quantity = body.quantity;

  // ===== Fan ポイント決済 (即時確定・Stripe不要) =====
  if (body.payMethod === 'FAN_POINT') {
    if (body.kind === 'SCENARIO') {
      if (!body.scenarioId) throw errors.badRequest('scenarioId が必要です');
      const result = await purchaseScenarioWithFanPoints(userId, body.scenarioId);
      if (!result.ok) {
        throw errors.conflict(FAN_POINT_ERROR_MESSAGES[result.reason] ?? '購入できません');
      }
      return NextResponse.json({
        payMethod: 'FAN_POINT',
        purchaseId: result.purchaseId,
        balance: result.balance,
      });
    } else if (body.kind === 'ITEM') {
      if (!body.itemId) throw errors.badRequest('itemId が必要です');
      const result = await purchaseItemWithFanPoints(userId, body.itemId, quantity);
      if (!result.ok) {
        throw errors.conflict(FAN_POINT_ERROR_MESSAGES[result.reason] ?? '購入できません');
      }
      return NextResponse.json({
        payMethod: 'FAN_POINT',
        purchaseId: result.purchaseId,
        balance: result.balance,
      });
    }
    throw errors.badRequest('kind が不正です');
  }

  // ===== Stripe 決済 (Checkout Session を作成し、webhook で確定) =====
  if (!body.successUrl || !body.cancelUrl) {
    throw errors.badRequest('successUrl / cancelUrl が必要です');
  }

  let amountJpy: number;
  let name: string;
  let scenarioId: string | null = null;
  let itemId: string | null = null;

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
      payMethod: 'STRIPE',
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

  return NextResponse.json({
    payMethod: 'STRIPE',
    checkoutUrl: checkout.url,
    sessionId: checkout.id,
  });
});
