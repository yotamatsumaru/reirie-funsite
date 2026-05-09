/**
 * POST /api/admin/orders/[id]/cancel
 *  - 注文をキャンセル (PENDING/PAID/PROCESSING のみ可)
 *  - 在庫の reserved を解放
 *  - PAID 以降の場合は Stripe 返金が必要 (本実装は status のみ。返金は別フローで)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { z } from 'zod';
import { requireAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const CancelBodySchema = z.object({
  reason: z.string().max(500).optional(),
});

export const POST = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireAdmin();
    const { id } = await ctx.params;
    const body = CancelBodySchema.parse(await req.json().catch(() => ({})));

    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!order) throw errors.notFound('注文が見つかりません');
    if (!['PENDING', 'PAID', 'PROCESSING'].includes(order.status)) {
      throw errors.conflict(`この注文はキャンセルできません (現在: ${order.status})`);
    }

    const updated = await prisma.$transaction(async (tx) => {
      // 在庫の reserved を解放
      for (const item of order.items) {
        await tx.inventory.update({
          where: { variantId: item.variantId },
          data: { reserved: { decrement: item.quantity } },
        });
      }
      return tx.order.update({
        where: { id },
        data: {
          status: 'CANCELED',
          canceledAt: new Date(),
          notes: body.reason
            ? (order.notes ? order.notes + '\n---\n' : '') + `[CANCEL] ${body.reason}`
            : order.notes,
        },
      });
    });

    await logAudit({
      userId: session.user.id,
      action: 'admin.order.canceled',
      resource: `order:${id}`,
      metadata: { reason: body.reason ?? null, prevStatus: order.status },
    });

    return NextResponse.json(updated);
  },
);
