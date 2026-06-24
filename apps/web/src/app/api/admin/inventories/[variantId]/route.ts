/**
 * GET  /api/admin/inventories/[variantId] - 在庫取得
 * PUT  /api/admin/inventories/[variantId] - 在庫数 (quantity / safetyStock) を上書き更新
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { UpdateInventorySchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const GET = handle(
  async (_req: Request, ctx: { params: Promise<{ variantId: string }> }) => {
    await requireCapability('MERCH');
    const { variantId } = await ctx.params;
    const inv = await prisma.inventory.findUnique({
      where: { variantId },
      include: {
        variant: {
          select: { id: true, sku: true, name: true, productId: true },
        },
      },
    });
    if (!inv) throw errors.notFound('在庫情報が見つかりません');
    return NextResponse.json({
      ...inv,
      available: Math.max(0, inv.quantity - inv.reserved - inv.safetyStock),
    });
  },
);

export const PUT = handle(
  async (req: Request, ctx: { params: Promise<{ variantId: string }> }) => {
    const session = await requireCapability('MERCH');
    const { variantId } = await ctx.params;
    const body = UpdateInventorySchema.parse(await req.json());

    const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!variant) throw errors.notFound('商品バリアントが見つかりません');

    const before = await prisma.inventory.findUnique({ where: { variantId } });

    // reserved を超えて quantity を減らせないようにチェック
    if (before && body.quantity < before.reserved) {
      throw errors.conflict(
        `予約中の在庫(${before.reserved}個)未満には設定できません`,
      );
    }

    const inv = await prisma.inventory.upsert({
      where: { variantId },
      create: {
        variantId,
        quantity: body.quantity,
        safetyStock: body.safetyStock ?? 0,
        reserved: 0,
      },
      update: {
        quantity: body.quantity,
        ...(body.safetyStock !== undefined ? { safetyStock: body.safetyStock } : {}),
      },
    });

    await logAudit({
      userId: session.user.id,
      action: 'admin.inventory.updated',
      resource: `variant:${variantId}`,
      metadata: {
        before: before
          ? { quantity: before.quantity, safetyStock: before.safetyStock }
          : null,
        after: { quantity: inv.quantity, safetyStock: inv.safetyStock },
      },
    });

    return NextResponse.json({
      ...inv,
      available: Math.max(0, inv.quantity - inv.reserved - inv.safetyStock),
    });
  },
);
