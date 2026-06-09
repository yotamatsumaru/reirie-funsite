/**
 * POST /api/admin/orders/[id]/ship
 *  - 注文を SHIPPED に遷移
 *  - tracking 番号を保存し、在庫の reserved を quantity から実引当して reserved=0 に減らす
 *  - 顧客にメール通知 (notifyCustomer=true 時)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { ShipOrderSchema } from '@idol/shared';
import { requireAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { sendEmail } from '@/lib/email';

export const runtime = 'nodejs';

export const POST = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireAdmin();
    const { id } = await ctx.params;
    const body = ShipOrderSchema.parse(await req.json());

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        user: { select: { email: true, displayName: true } },
      },
    });
    if (!order) throw errors.notFound('注文が見つかりません');
    if (order.status !== 'PAID' && order.status !== 'PROCESSING') {
      throw errors.conflict(
        `この注文は出荷可能な状態ではありません (現在: ${order.status})`,
      );
    }

    // 在庫: reserved を解放しつつ quantity を実減算 (1トランザクション)
    const updated = await prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        await tx.inventory.update({
          where: { variantId: item.variantId },
          data: {
            quantity: { decrement: item.quantity },
            reserved: { decrement: item.quantity },
          },
        });
      }
      return tx.order.update({
        where: { id },
        data: {
          status: 'SHIPPED',
          trackingNumber: body.trackingNumber,
          shippedAt: new Date(),
        },
      });
    });

    if (body.notifyCustomer && order.user?.email) {
      await sendEmail({
        to: order.user.email,
        subject: `【発送のお知らせ】ご注文 ${order.orderNumber}`,
        text:
          `${order.user.displayName ?? 'お客'}様\n\n` +
          `ご注文 ${order.orderNumber} を発送いたしました。\n` +
          `お問い合わせ番号: ${body.trackingNumber}\n` +
          (body.carrier ? `配送業者: ${body.carrier}\n` : '') +
          `\nご利用ありがとうございました。`,
      });
    }

    await logAudit({
      userId: session.user.id,
      action: 'admin.order.shipped',
      resource: `order:${id}`,
      metadata: { trackingNumber: body.trackingNumber, carrier: body.carrier },
    });

    return NextResponse.json(updated);
  },
);
