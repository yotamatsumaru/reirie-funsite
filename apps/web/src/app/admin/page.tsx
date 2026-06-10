import type { Metadata } from 'next';
import { prisma } from '@idol/db';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatJpy } from '@/lib/pricing';
import {
  Users,
  TrendingUp,
  CalendarRange,
  CreditCard,
  PackageSearch,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';

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
      <header>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">ダッシュボード</h1>
        <p className="mt-1.5 text-sm text-slate-500">運営状況のサマリ・在庫アラート。</p>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Users} label="総会員数" value={String(userTotal)} accent="brand" />
        <Stat
          icon={TrendingUp}
          label="本日売上"
          value={formatJpy(todayPaid._sum.totalAmount ?? 0)}
          sub={`${todayPaid._count._all} 件`}
          accent="emerald"
        />
        <Stat
          icon={CalendarRange}
          label="今月売上"
          value={formatJpy(monthPaid._sum.totalAmount ?? 0)}
          accent="violet"
        />
        <Stat
          icon={CreditCard}
          label="アクティブ課金"
          value={String(byPlan.reduce((s, p) => s + p._count._all, 0))}
          accent="rose"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-900">プラン別会員数</h2>
          </CardHeader>
          <CardBody>
            <ul className="space-y-2.5 text-sm">
              {byPlan.map((p) => (
                <li key={p.planType} className="flex items-center justify-between">
                  <Badge tone={p.planType === 'PREMIUM' ? 'brand' : 'info'}>{p.planType}</Badge>
                  <span className="font-semibold tabular-nums text-slate-900">
                    {p._count._all} 人
                  </span>
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
            <h2 className="text-base font-semibold text-slate-900">注文ステータス</h2>
          </CardHeader>
          <CardBody>
            <ul className="space-y-2.5 text-sm">
              {ordersByStatus.length === 0 && (
                <li className="text-slate-500">注文はまだありません</li>
              )}
              {ordersByStatus.map((o) => (
                <li key={o.status} className="flex items-center justify-between">
                  <span className="text-slate-700">{o.status}</span>
                  <span className="font-semibold tabular-nums text-slate-900">
                    {o._count._all} 件
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <PackageSearch className="h-4 w-4 text-slate-500" aria-hidden />
            <h2 className="text-base font-semibold text-slate-900">在庫アラート</h2>
          </div>
        </CardHeader>
        <CardBody>
          {lowStock.length === 0 ? (
            <p className="text-sm text-slate-500">在庫アラートはありません</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {lowStock.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5"
                >
                  <span className="inline-flex items-center gap-2 text-slate-800">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600" aria-hidden />
                    <span className="truncate">
                      {s.variant.product.name} / {s.variant.name}
                    </span>
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

// =============================================================
// Sub components
// =============================================================
const STAT_ACCENTS = {
  brand: 'bg-brand-50 text-brand-600 ring-brand-100',
  emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  violet: 'bg-violet-50 text-violet-600 ring-violet-100',
  rose: 'bg-rose-50 text-rose-600 ring-rose-100',
} as const;

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  accent: keyof typeof STAT_ACCENTS;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900 sm:text-3xl">
            {value}
          </p>
          {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
        </div>
        <span
          className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${STAT_ACCENTS[accent]}`}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      </div>
    </div>
  );
}
