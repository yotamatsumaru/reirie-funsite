/**
 * GET /api/admin/orders
 *  - 全注文一覧 (ステータス絞り込み・検索)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { AdminListOrdersQuerySchema } from '@idol/shared';
import { requireAdmin } from '@/auth';
import { handle } from '@/lib/errors';
import type { Prisma } from '@idol/db';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  await requireAdmin();
  const url = new URL(req.url);
  const query = AdminListOrdersQuerySchema.parse({
    status: url.searchParams.get('status') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: url.searchParams.get('page') ?? 1,
    limit: url.searchParams.get('limit') ?? 30,
  });

  const where: Prisma.OrderWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.q
      ? {
          OR: [
            { orderNumber: { contains: query.q, mode: 'insensitive' as const } },
            { shippingName: { contains: query.q, mode: 'insensitive' as const } },
            { user: { email: { contains: query.q, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        user: { select: { id: true, email: true, displayName: true } },
        items: { select: { id: true, productName: true, variantName: true, quantity: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return NextResponse.json({
    items,
    page: query.page,
    limit: query.limit,
    total,
    hasMore: query.page * query.limit < total,
  });
});
