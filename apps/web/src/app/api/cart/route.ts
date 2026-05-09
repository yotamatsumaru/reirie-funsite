/**
 * GET /api/cart
 *  - 現在のユーザーのカート (なければ作成)
 *  - 各 line item にプラン別の有効単価/在庫を付与
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { canAccess } from '@idol/shared';
import { requireSession } from '@/auth';
import { handle } from '@/lib/errors';
import { calculateOrderTotals, effectiveUnitPrice } from '@/lib/pricing';

export const runtime = 'nodejs';

async function getOrCreateCart(userId: string) {
  const existing = await prisma.cart.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return existing;
  return prisma.cart.create({ data: { userId } });
}

export const GET = handle(async () => {
  const session = await requireSession();
  const plan = session.user.plan;
  const cart = await getOrCreateCart(session.user.id);

  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
    orderBy: { createdAt: 'asc' },
  });

  const variantIds = items.map((i) => i.variantId);
  const variants = variantIds.length
    ? await prisma.productVariant.findMany({
        where: { id: { in: variantIds } },
        include: {
          product: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } } },
          inventory: true,
        },
      })
    : [];
  const variantMap = new Map(variants.map((v) => [v.id, v]));

  const lineItems: Array<{
    id: string;
    variantId: string;
    productId: string;
    productSlug: string;
    productName: string;
    variantName: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    thumbnailUrl: string | null;
    inStock: boolean;
    available: number;
    blocked: false | { reason: string };
  }> = [];
  let subtotal = 0;

  for (const item of items) {
    const v = variantMap.get(item.variantId);
    if (!v) continue;

    let blocked: false | { reason: string } = false;
    if (!v.isActive || !v.product.isActive) blocked = { reason: 'inactive' };
    if (v.product.isPremiumExclusive && !canAccess(plan, 'PREMIUM')) {
      blocked = { reason: 'plan_required' };
    }
    if (v.product.isMembersOnly && !canAccess(plan, 'MEMBERS')) {
      blocked = { reason: 'plan_required' };
    }

    const unit = effectiveUnitPrice(
      {
        basePrice: v.product.basePrice,
        memberPrice: v.product.memberPrice,
        premiumPrice: v.product.premiumPrice,
      },
      v.priceDelta,
      plan,
    );
    const lineSubtotal = unit * item.quantity;
    if (!blocked) subtotal += lineSubtotal;

    const available = v.inventory
      ? Math.max(0, v.inventory.quantity - v.inventory.reserved - v.inventory.safetyStock)
      : 0;

    lineItems.push({
      id: item.id,
      variantId: v.id,
      productId: v.productId,
      productSlug: v.product.slug,
      productName: v.product.name,
      variantName: v.name,
      quantity: item.quantity,
      unitPrice: unit,
      subtotal: lineSubtotal,
      thumbnailUrl: v.product.images[0]?.url ?? null,
      inStock: available >= item.quantity,
      available,
      blocked,
    });
  }

  const totals = calculateOrderTotals(subtotal);

  return NextResponse.json({
    cartId: cart.id,
    items: lineItems,
    ...totals,
  });
});
