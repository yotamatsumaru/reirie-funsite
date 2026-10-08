/**
 * POST /api/cart/items
 *  - カートにアイテムを追加 (同じバリエーション + 同じオプション入力なら数量加算)
 *  - 商品オプション (宛名など) は必須/文字数をサーバー側で検証し、
 *    入力値をスナップショットとしてカート明細に保存する
 */
import { NextResponse } from 'next/server';
import { prisma, type Prisma } from '@idol/db';
import {
  AddToCartSchema,
  buildOptionsKey,
  canAccess,
  canUseShop,
  getSaleStatus,
  validateOptionInputs,
} from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';

export const runtime = 'nodejs';

async function getOrCreateCart(userId: string) {
  const existing = await prisma.cart.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return existing;
  return prisma.cart.create({ data: { userId } });
}

export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const plan = session.user.plan;

  // 無料会員 (FREE) / 未認証プランは物販 (EC) を利用できない
  if (!canUseShop(plan)) {
    throw errors.forbidden('物販（ショップ）のご利用にはスタンダード以上のプランが必要です');
  }

  const body = AddToCartSchema.parse(await req.json());

  const variant = await prisma.productVariant.findUnique({
    where: { id: body.variantId },
    include: {
      product: { include: { options: { orderBy: { sortOrder: 'asc' } } } },
      inventory: true,
    },
  });
  if (!variant || !variant.isActive || !variant.product.isActive) {
    throw errors.notFound('商品が見つかりません');
  }

  // 販売期間チェック (発売前 / 販売終了)
  const saleStatus = getSaleStatus(variant.product);
  if (saleStatus === 'UPCOMING') {
    throw errors.conflict('この商品はまだ発売前です');
  }
  if (saleStatus === 'ENDED') {
    throw errors.conflict('この商品の販売は終了しました');
  }

  // プランチェック
  if (variant.product.isPremiumExclusive && !canAccess(plan, 'PREMIUM')) {
    throw errors.planRequired('プレミアム');
  }
  if (variant.product.isMembersOnly && !canAccess(plan, 'MEMBERS')) {
    throw errors.planRequired('スタンダード');
  }

  // 商品オプション (宛名など) の検証
  const optionResult = validateOptionInputs(variant.product.options, body.options);
  if (!optionResult.ok) {
    throw errors.badRequest(optionResult.message);
  }
  const optionsKey = buildOptionsKey(optionResult.values);

  // 在庫チェック
  const available = variant.inventory
    ? Math.max(
        0,
        variant.inventory.quantity - variant.inventory.reserved - variant.inventory.safetyStock,
      )
    : 0;
  if (available < body.quantity) {
    throw errors.conflict('在庫が不足しています');
  }

  const cart = await getOrCreateCart(session.user.id);

  const item = await prisma.cartItem.upsert({
    where: {
      cartId_variantId_optionsKey: { cartId: cart.id, variantId: variant.id, optionsKey },
    },
    update: { quantity: { increment: body.quantity } },
    create: {
      cartId: cart.id,
      variantId: variant.id,
      quantity: body.quantity,
      optionsKey,
      optionValues:
        optionResult.values.length > 0
          ? (optionResult.values as unknown as Prisma.InputJsonValue)
          : undefined,
    },
  });

  // 上限チェック
  if (item.quantity > 99) {
    await prisma.cartItem.update({ where: { id: item.id }, data: { quantity: 99 } });
  }

  return NextResponse.json({ id: item.id, quantity: Math.min(item.quantity, 99) }, { status: 201 });
});
