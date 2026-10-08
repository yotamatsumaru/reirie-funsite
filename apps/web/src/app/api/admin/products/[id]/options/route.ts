/**
 * GET  /api/admin/products/[id]/options - 商品オプション一覧
 * POST /api/admin/products/[id]/options - 商品オプション追加
 *
 * BASE の「商品オプション App」相当。宛名付きチェキの「宛名」など、
 * 購入時に購入者へ入力してもらう項目を商品ごとに定義する。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { ProductOptionInputSchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const GET = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    await requireCapability('MERCH');
    const { id } = await ctx.params;
    const items = await prisma.productOption.findMany({
      where: { productId: id },
      orderBy: { sortOrder: 'asc' },
    });
    return NextResponse.json({ items });
  },
);

export const POST = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('MERCH');
    const { id } = await ctx.params;
    const body = ProductOptionInputSchema.parse(await req.json());

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) throw errors.notFound('商品が見つかりません');

    const count = await prisma.productOption.count({ where: { productId: id } });
    if (count >= 10) throw errors.badRequest('オプションは 1 商品につき 10 個までです');

    const created = await prisma.productOption.create({
      data: {
        productId: id,
        name: body.name,
        helpText: body.helpText ?? null,
        maxLength: body.maxLength,
        price: body.price,
        isRequired: body.isRequired,
        // 省略時は末尾に追加
        sortOrder: body.sortOrder || count,
      },
    });
    await logAudit({
      userId: session.user.id,
      action: 'admin.product_option.created',
      resource: `product_option:${created.id}`,
      metadata: { productId: id, name: created.name },
    });
    return NextResponse.json(created, { status: 201 });
  },
);
