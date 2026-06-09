/**
 * GET /api/orders/[id]
 *  - 自分の注文詳細
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireSession } from '@/auth';
import { errors, handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireSession();
    const { id } = await ctx.params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        payments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            kind: true,
            status: true,
            amount: true,
            currency: true,
            receiptUrl: true,
            createdAt: true,
          },
        },
      },
    });

    if (!order) throw errors.notFound('注文が見つかりません');
    const isAdminRole =
      session.user.role === 'ADMIN' || session.user.role === 'SUPER_ADMIN';
    if (order.userId !== session.user.id && !isAdminRole) {
      throw errors.forbidden();
    }
    return NextResponse.json(order);
  },
);
