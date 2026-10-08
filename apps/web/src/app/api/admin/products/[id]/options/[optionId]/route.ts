/**
 * PATCH  /api/admin/products/[id]/options/[optionId] - 商品オプション更新
 * DELETE /api/admin/products/[id]/options/[optionId] - 商品オプション削除
 *   (過去の注文明細には入力値がスナップショットで残るため、削除しても注文内容は変わらない)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { ProductOptionInputSchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const UpdateSchema = ProductOptionInputSchema.partial();

async function loadOwned(productId: string, optionId: string) {
  const opt = await prisma.productOption.findUnique({ where: { id: optionId } });
  if (!opt || opt.productId !== productId) throw errors.notFound('オプションが見つかりません');
  return opt;
}

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string; optionId: string }> }) => {
    const session = await requireCapability('MERCH');
    const { id, optionId } = await ctx.params;
    const body = UpdateSchema.parse(await req.json());
    await loadOwned(id, optionId);

    const updated = await prisma.productOption.update({
      where: { id: optionId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.helpText !== undefined ? { helpText: body.helpText } : {}),
        ...(body.maxLength !== undefined ? { maxLength: body.maxLength } : {}),
        ...(body.price !== undefined ? { price: body.price } : {}),
        ...(body.isRequired !== undefined ? { isRequired: body.isRequired } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      },
    });
    await logAudit({
      userId: session.user.id,
      action: 'admin.product_option.updated',
      resource: `product_option:${optionId}`,
      metadata: { productId: id, changes: Object.keys(body) },
    });
    return NextResponse.json(updated);
  },
);

export const DELETE = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string; optionId: string }> }) => {
    const session = await requireCapability('MERCH');
    const { id, optionId } = await ctx.params;
    await loadOwned(id, optionId);
    await prisma.productOption.delete({ where: { id: optionId } });
    await logAudit({
      userId: session.user.id,
      action: 'admin.product_option.deleted',
      resource: `product_option:${optionId}`,
      metadata: { productId: id },
    });
    return NextResponse.json({ deleted: true });
  },
);
