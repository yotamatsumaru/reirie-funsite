/**
 * GET    /api/admin/products/[id] - 商品詳細 (variants/inventory込み)
 * PATCH  /api/admin/products/[id] - 商品更新
 * DELETE /api/admin/products/[id] - 商品削除 (関連 variants/inventory もカスケード)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { CreateProductSchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

// slug は自動生成・変更不可のため、更新スキーマからは除外する
const UpdateProductSchema = CreateProductSchema.omit({ slug: true }).partial();

export const GET = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    await requireCapability('MERCH');
    const { id } = await ctx.params;
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        images: { orderBy: { sortOrder: 'asc' } },
        variants: {
          orderBy: { createdAt: 'asc' },
          include: { inventory: true },
        },
      },
    });
    if (!product) throw errors.notFound('商品が見つかりません');
    return NextResponse.json(product);
  },
);

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('MERCH');
    const { id } = await ctx.params;
    const body = UpdateProductSchema.parse(await req.json());

    const exists = await prisma.product.findUnique({ where: { id } });
    if (!exists) throw errors.notFound('商品が見つかりません');

    if (body.categoryId) {
      const cat = await prisma.productCategory.findUnique({ where: { id: body.categoryId } });
      if (!cat) throw errors.badRequest('カテゴリが見つかりません');
    }

    const updated = await prisma.product.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.basePrice !== undefined ? { basePrice: body.basePrice } : {}),
        ...(body.memberPrice !== undefined ? { memberPrice: body.memberPrice } : {}),
        ...(body.premiumPrice !== undefined ? { premiumPrice: body.premiumPrice } : {}),
        ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.isMembersOnly !== undefined ? { isMembersOnly: body.isMembersOnly } : {}),
        ...(body.isPremiumExclusive !== undefined
          ? { isPremiumExclusive: body.isPremiumExclusive }
          : {}),
      },
    });

    await logAudit({
      userId: session.user.id,
      action: 'admin.product.updated',
      resource: `product:${id}`,
      metadata: { changes: Object.keys(body) },
    });
    return NextResponse.json(updated);
  },
);

export const DELETE = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('MERCH');
    const { id } = await ctx.params;
    const exists = await prisma.product.findUnique({ where: { id } });
    if (!exists) throw errors.notFound('商品が見つかりません');

    // 注文に含まれている variant がある場合は論理削除 (isActive=false) にする
    const hasOrderItems = await prisma.orderItem.count({ where: { productId: id } });
    if (hasOrderItems > 0) {
      await prisma.product.update({ where: { id }, data: { isActive: false } });
      await prisma.productVariant.updateMany({
        where: { productId: id },
        data: { isActive: false },
      });
      await logAudit({
        userId: session.user.id,
        action: 'admin.product.soft_deleted',
        resource: `product:${id}`,
        metadata: { reason: 'has_order_history' },
      });
      return NextResponse.json({ softDeleted: true });
    }

    await prisma.product.delete({ where: { id } });
    await logAudit({
      userId: session.user.id,
      action: 'admin.product.deleted',
      resource: `product:${id}`,
    });
    return NextResponse.json({ deleted: true });
  },
);
