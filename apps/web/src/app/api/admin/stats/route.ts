/**
 * GET /api/admin/stats
 *  - ダッシュボード用の集計データ
 *    - 会員数 (合計 / 有効サブスク数 / プラン別)
 *    - 売上 (本日 / 今月 / 累計)
 *    - 注文 (ステータス別件数)
 *    - 在庫アラート (safetyStock を割っている variant)
 *    - 直近7日間の日別売上
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireAdmin } from '@/auth';
import { handle } from '@/lib/errors';

export const runtime = 'nodejs';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export const GET = handle(async () => {
  await requireAdmin();
  const now = new Date();
  const today = startOfDay(now);
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const sevenDaysAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);

  // 会員数
  const [totalUsers, activeSubsByPlan] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.subscription.groupBy({
      by: ['planType'],
      where: { status: { in: ['ACTIVE', 'TRIALING'] } },
      _count: { _all: true },
    }),
  ]);

  const planCounts: Record<'STANDARD' | 'PREMIUM', number> = { STANDARD: 0, PREMIUM: 0 };
  for (const row of activeSubsByPlan) {
    if (row.planType === 'STANDARD' || row.planType === 'PREMIUM') {
      planCounts[row.planType] = row._count._all;
    }
  }
  const activeSubsTotal = planCounts.STANDARD + planCounts.PREMIUM;

  // 売上 (PaymentStatus=SUCCEEDED 基準)
  const [todayPaid, monthPaid, totalPaid] = await Promise.all([
    prisma.payment.aggregate({
      where: { status: 'SUCCEEDED', createdAt: { gte: today } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.payment.aggregate({
      where: { status: 'SUCCEEDED', createdAt: { gte: thisMonth } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.payment.aggregate({
      where: { status: 'SUCCEEDED' },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  // 注文ステータス別
  const ordersByStatus = await prisma.order.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  const orderStatus: Record<string, number> = {};
  for (const row of ordersByStatus) {
    orderStatus[row.status] = row._count._all;
  }

  // 在庫アラート: 利用可能在庫 ≤ 0
  const lowStockRows = await prisma.inventory.findMany({
    where: {},
    include: {
      variant: {
        select: {
          id: true,
          sku: true,
          name: true,
          product: { select: { id: true, slug: true, name: true } },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });
  const lowStock = lowStockRows
    .filter((inv) => inv.quantity - inv.reserved - inv.safetyStock <= 0)
    .slice(0, 20)
    .map((inv) => ({
      variantId: inv.variantId,
      sku: inv.variant.sku,
      variantName: inv.variant.name,
      productId: inv.variant.product.id,
      productName: inv.variant.product.name,
      quantity: inv.quantity,
      reserved: inv.reserved,
      safetyStock: inv.safetyStock,
      available: Math.max(0, inv.quantity - inv.reserved - inv.safetyStock),
    }));

  // 直近7日間の日別売上 (PostgreSQL date_trunc を使用)
  const dailyRevenue = await prisma.$queryRaw<
    Array<{ day: Date; amount: bigint; count: bigint }>
  >`
    SELECT date_trunc('day', "created_at") AS day,
           COALESCE(SUM(amount), 0)::bigint AS amount,
           COUNT(*)::bigint AS count
    FROM payments
    WHERE status = 'SUCCEEDED'
      AND "created_at" >= ${sevenDaysAgo}
    GROUP BY day
    ORDER BY day ASC
  `;

  return NextResponse.json({
    users: {
      total: totalUsers,
      activeSubs: activeSubsTotal,
      byPlan: planCounts,
    },
    revenue: {
      today: { amount: todayPaid._sum.amount ?? 0, count: todayPaid._count._all },
      month: { amount: monthPaid._sum.amount ?? 0, count: monthPaid._count._all },
      total: { amount: totalPaid._sum.amount ?? 0, count: totalPaid._count._all },
      daily: dailyRevenue.map((r) => ({
        day: r.day.toISOString().slice(0, 10),
        amount: Number(r.amount),
        count: Number(r.count),
      })),
    },
    orders: {
      byStatus: orderStatus,
    },
    inventory: {
      lowStock,
    },
    generatedAt: now.toISOString(),
  });
});
