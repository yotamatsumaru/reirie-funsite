import type { Metadata } from 'next';
import { prisma } from '@idol/db';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatJpy } from '@/lib/pricing';

export const metadata: Metadata = { title: '管理ダッシュボード' };
export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  const [userTotal, byPlan, todayPaid, monthPaid, ordersByStatus, lowStock] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.subscription.groupBy({
      by: ['planType'],
      where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
      _count: { _all: true },
    }),
    prisma.order.aggregate({
      where: {
        status: { in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
        paidAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
    prisma.order.aggregate({
      where: {
        status: { in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
        paidAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      },
      _sum: { totalAmount: true },
    }),
    prisma.order.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.inventory.findMany({
      where: { quantity: { lte: 10 } },
      take: 5,
      include: { variant: { include: { product: true } } },
    }),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-slate-800">ダッシュボード</h1>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="総会員数" value={String(userTotal)} />
        <Stat
          label="本日売上"
          value={formatJpy(todayPaid._sum.totalAmount ?? 0)}
          sub={`${todayPaid._count._all}件`}
        />
        <Stat label="今月売上" value={formatJpy(monthPaid._sum.totalAmount ?? 0)} />
        <Stat
          label="アクティブ課金"
          value={String(byPlan.reduce((s, p) => s + p._count._all, 0))}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">プラン別会員数</h2>
          </CardHeader>
          <CardBody>
            <ul className="space-y-2 text-sm">
              {byPlan.map((p) => (
                <li key={p.planType} className="flex items-center justify-between">
                  <Badge tone={p.planType === 'PREMIUM' ? 'brand' : 'info'}>{p.planType}</Badge>
                  <span className="font-semibold">{p._count._all}人</span>
                </li>
              ))}
              {byPlan.length === 0 && (
                <li className="text-slate-500">アクティブな課金会員はいません</li>
              )}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">注文ステータス</h2>
          </CardHeader>
          <CardBody>
            <ul className="space-y-2 text-sm">
              {ordersByStatus.map((o) => (
                <li key={o.status} className="flex items-center justify-between">
                  <span>{o.status}</span>
                  <span className="font-semibold">{o._count._all}件</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">在庫アラート</h2>
        </CardHeader>
        <CardBody>
          {lowStock.length === 0 ? (
            <p className="text-sm text-slate-500">在庫アラートはありません</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {lowStock.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-md bg-amber-50 px-3 py-2"
                >
                  <span>
                    {s.variant.product.name} / {s.variant.name}
                  </span>
                  <Badge tone="warning">残 {s.quantity - s.reserved}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-bold text-slate-800">{value}</p>
        {sub && <p className="text-xs text-slate-400">{sub}</p>}
      </CardBody>
    </Card>
  );
}
