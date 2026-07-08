/**
 * PATCH /api/cart/items/[id]
 *   - 数量変更 (quantity=0 で削除)
 * DELETE /api/cart/items/[id]
 *   - 削除
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { UpdateCartItemSchema } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';

export const runtime = 'nodejs';

async function loadOwnedItem(itemId: string, userId: string) {
  const item = await prisma.cartItem.findUnique({
    where: { id: itemId },
    include: { cart: true },
  });
  if (!item || item.cart.userId !== userId) throw errors.notFound('カートアイテムが見つかりません');
  return item;
}

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireApiSession(req);
    const { id } = await ctx.params;
    const body = UpdateCartItemSchema.parse(await req.json());

    const item = await loadOwnedItem(id, session.user.id);

    if (body.quantity === 0) {
      await prisma.cartItem.delete({ where: { id: item.id } });
      return NextResponse.json({ deleted: true });
    }

    // 在庫チェック
    const variant = await prisma.productVariant.findUnique({
      where: { id: item.variantId },
      include: { inventory: true },
    });
    if (!variant) throw errors.notFound('商品が見つかりません');
    const available = variant.inventory
      ? Math.max(
          0,
          variant.inventory.quantity - variant.inventory.reserved - variant.inventory.safetyStock,
        )
      : 0;
    if (available < body.quantity) throw errors.conflict('在庫が不足しています');

    const updated = await prisma.cartItem.update({
      where: { id: item.id },
      data: { quantity: body.quantity },
    });
    return NextResponse.json({ id: updated.id, quantity: updated.quantity });
  },
);

export const DELETE = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireApiSession(req);
    const { id } = await ctx.params;
    const item = await loadOwnedItem(id, session.user.id);
    await prisma.cartItem.delete({ where: { id: item.id } });
    return NextResponse.json({ deleted: true });
  },
);
