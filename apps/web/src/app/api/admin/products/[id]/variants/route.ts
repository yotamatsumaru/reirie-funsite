/**
 * POST /api/admin/products/[id]/variants
 *  - 商品の variant を作成 (同時に inventory も初期化)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { CreateProductVariantSchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const POST = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('MERCH');
    const { id } = await ctx.params;
    const body = CreateProductVariantSchema.parse(await req.json());

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) throw errors.notFound('商品が見つかりません');

    const dupSku = await prisma.productVariant.findUnique({ where: { sku: body.sku } });
    if (dupSku) throw errors.conflict('同じ SKU が既に存在します');

    const created = await prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.create({
        data: {
          productId: id,
          sku: body.sku,
          name: body.name,
          optionColor: body.optionColor,
          optionSize: body.optionSize,
          priceDelta: body.priceDelta,
          weightGrams: body.weightGrams,
          isActive: body.isActive,
        },
      });
      await tx.inventory.create({
        data: {
          variantId: variant.id,
          quantity: body.initialQuantity,
          safetyStock: body.safetyStock,
          reserved: 0,
        },
      });
      return variant;
    });

    await logAudit({
      userId: session.user.id,
      action: 'admin.variant.created',
      resource: `variant:${created.id}`,
      metadata: { sku: created.sku, productId: id },
    });

    return NextResponse.json(created, { status: 201 });
  },
);
