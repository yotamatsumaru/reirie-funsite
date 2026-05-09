/**
 * POST /api/cart/items
 *  - カートにアイテムを追加 (既存があれば数量加算)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { AddToCartSchema, canAccess } from '@idol/shared';
import { requireSession } from '@/auth';
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
  const session = await requireSession();
  const plan = session.user.plan;
  const body = AddToCartSchema.parse(await req.json());

  const variant = await prisma.productVariant.findUnique({
    where: { id: body.variantId },
    include: { product: true, inventory: true },
  });
  if (!variant || !variant.isActive || !variant.product.isActive) {
    throw errors.notFound('商品が見つかりません');
  }

  // プランチェック
  if (variant.product.isPremiumExclusive && !canAccess(plan, 'PREMIUM')) {
    throw errors.planRequired('プレミアム');
  }
  if (variant.product.isMembersOnly && !canAccess(plan, 'MEMBERS')) {
    throw errors.planRequired('スタンダード');
  }

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
    where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
    update: { quantity: { increment: body.quantity } },
    create: { cartId: cart.id, variantId: variant.id, quantity: body.quantity },
  });

  // 上限チェック
  if (item.quantity > 99) {
    await prisma.cartItem.update({ where: { id: item.id }, data: { quantity: 99 } });
  }

  return NextResponse.json({ id: item.id, quantity: Math.min(item.quantity, 99) }, { status: 201 });
});
