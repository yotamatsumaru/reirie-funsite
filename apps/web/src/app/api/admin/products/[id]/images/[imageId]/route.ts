/**
 * DELETE /api/admin/products/[id]/images/[imageId] - 商品画像を削除
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const DELETE = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string; imageId: string }> }) => {
    const session = await requireCapability('MERCH');
    const { id, imageId } = await ctx.params;

    const image = await prisma.productImage.findUnique({ where: { id: imageId } });
    if (!image || image.productId !== id) {
      throw errors.notFound('画像が見つかりません');
    }

    await prisma.productImage.delete({ where: { id: imageId } });

    await logAudit({
      userId: session.user.id,
      action: 'admin.product.image_deleted',
      resource: `product:${id}`,
      metadata: { imageId },
    });

    return NextResponse.json({ deleted: true });
  },
);
