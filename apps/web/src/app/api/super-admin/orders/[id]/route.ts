/**
 * PATCH /api/super-admin/orders/[id]
 *   - 返金 / 発送 / キャンセル
 *   - SUPER_ADMIN 限定
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@idol/db';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const Schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('refund') }),
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('ship'), trackingNumber: z.string().nullable().optional() }),
]);

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireSuperAdmin();
    const { id } = await ctx.params;

    const body = (await req.json().catch(() => ({}))) as unknown;
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
    }

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw errors.notFound('注文が見つかりません');

    if (parsed.data.action === 'refund') {
      // Note: 本番では Stripe API で refund を実行する必要がある
      await prisma.order.update({
        where: { id },
        data: { status: 'REFUNDED', canceledAt: new Date() },
      });
      await logAudit({
        userId: session.user.id,
        action: 'order.refund',
        resource: `order:${id}`,
        metadata: { orderNumber: order.orderNumber, amount: order.totalAmount },
      });
      return NextResponse.json({ ok: true });
    }

    if (parsed.data.action === 'cancel') {
      await prisma.order.update({
        where: { id },
        data: { status: 'CANCELED', canceledAt: new Date() },
      });
      await logAudit({
        userId: session.user.id,
        action: 'order.cancel',
        resource: `order:${id}`,
        metadata: { orderNumber: order.orderNumber },
      });
      return NextResponse.json({ ok: true });
    }

    // ship
    await prisma.order.update({
      where: { id },
      data: {
        status: 'SHIPPED',
        shippedAt: new Date(),
        trackingNumber: parsed.data.trackingNumber ?? null,
      },
    });
    await logAudit({
      userId: session.user.id,
      action: 'order.ship',
      resource: `order:${id}`,
      metadata: { trackingNumber: parsed.data.trackingNumber },
    });
    return NextResponse.json({ ok: true });
  },
);
