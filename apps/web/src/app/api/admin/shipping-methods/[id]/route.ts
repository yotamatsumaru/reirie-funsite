/**
 * PATCH  /api/admin/shipping-methods/[id] - 配送方法更新
 * DELETE /api/admin/shipping-methods/[id] - 配送方法削除
 *   - 注文で使われたことがある場合は論理削除 (isActive=false)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { ShippingMethodInputSchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const UpdateSchema = ShippingMethodInputSchema.partial();

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('MERCH');
    const { id } = await ctx.params;
    const body = UpdateSchema.parse(await req.json());
    const exists = await prisma.shippingMethod.findUnique({ where: { id } });
    if (!exists) throw errors.notFound('配送方法が見つかりません');

    const updated = await prisma.shippingMethod.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.fee !== undefined ? { fee: body.fee } : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        ...(body.b2InvoiceType !== undefined ? { b2InvoiceType: body.b2InvoiceType } : {}),
      },
    });
    await logAudit({
      userId: session.user.id,
      action: 'admin.shipping_method.updated',
      resource: `shipping_method:${id}`,
      metadata: { changes: Object.keys(body) },
    });
    return NextResponse.json(updated);
  },
);

export const DELETE = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('MERCH');
    const { id } = await ctx.params;
    const exists = await prisma.shippingMethod.findUnique({ where: { id } });
    if (!exists) throw errors.notFound('配送方法が見つかりません');

    const used = await prisma.order.count({ where: { shippingMethodId: id } });
    if (used > 0) {
      await prisma.shippingMethod.update({ where: { id }, data: { isActive: false, isDefault: false } });
      await logAudit({
        userId: session.user.id,
        action: 'admin.shipping_method.soft_deleted',
        resource: `shipping_method:${id}`,
        metadata: { reason: 'has_order_history' },
      });
      return NextResponse.json({ softDeleted: true });
    }
    await prisma.shippingMethod.delete({ where: { id } });
    await logAudit({
      userId: session.user.id,
      action: 'admin.shipping_method.deleted',
      resource: `shipping_method:${id}`,
    });
    return NextResponse.json({ deleted: true });
  },
);
