/**
 * GET   /api/admin/products/[id]/images - 商品画像一覧
 * POST  /api/admin/products/[id]/images - 画像URLを追加（末尾に追加）
 * PATCH /api/admin/products/[id]/images - 画像の表示順を並べ替え
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { AddProductImageSchema, ReorderProductImagesSchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const GET = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    await requireCapability('MERCH');
    const { id } = await ctx.params;
    const images = await prisma.productImage.findMany({
      where: { productId: id },
      orderBy: { sortOrder: 'asc' },
    });
    return NextResponse.json({ items: images });
  },
);

export const POST = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('MERCH');
    const { id } = await ctx.params;
    const body = AddProductImageSchema.parse(await req.json());

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) throw errors.notFound('商品が見つかりません');

    const last = await prisma.productImage.findFirst({
      where: { productId: id },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const nextOrder = (last?.sortOrder ?? -1) + 1;

    const created = await prisma.productImage.create({
      data: {
        productId: id,
        url: body.url,
        alt: body.alt ?? null,
        sortOrder: nextOrder,
      },
    });

    await logAudit({
      userId: session.user.id,
      action: 'admin.product.image_added',
      resource: `product:${id}`,
      metadata: { imageId: created.id },
    });

    return NextResponse.json(created, { status: 201 });
  },
);

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('MERCH');
    const { id } = await ctx.params;
    const body = ReorderProductImagesSchema.parse(await req.json());

    const images = await prisma.productImage.findMany({
      where: { productId: id },
      select: { id: true },
    });
    const valid = new Set(images.map((i) => i.id));
    if (body.order.some((imgId) => !valid.has(imgId))) {
      throw errors.badRequest('この商品に属さない画像が含まれています');
    }

    await prisma.$transaction(
      body.order.map((imgId, idx) =>
        prisma.productImage.update({
          where: { id: imgId },
          data: { sortOrder: idx },
        }),
      ),
    );

    await logAudit({
      userId: session.user.id,
      action: 'admin.product.images_reordered',
      resource: `product:${id}`,
      metadata: { order: body.order },
    });

    const updated = await prisma.productImage.findMany({
      where: { productId: id },
      orderBy: { sortOrder: 'asc' },
    });
    return NextResponse.json({ items: updated });
  },
);
