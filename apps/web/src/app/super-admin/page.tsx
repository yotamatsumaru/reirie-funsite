/**
 * /super-admin — ダッシュボード
 *
 * KPI:
 *  - 総会員数 / 新規登録 (7日)
 *  - アクティブサブスク数 / MRR (月次経常収益)
 *  - 直近の注文・売上
 *  - 監査ログのサマリ
 */
import { prisma } from '@idol/db';
import type { Metadata } from 'next';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import Link from 'next/link';
import { PLAN_PRICES, type PlanTypeLiteral } from '@idol/shared';
import {
  Users,
  CreditCard,
  TrendingUp,
  Wallet,
  Search,
  UserPlus,
  ScrollText,
  ArrowUpRight,
  type LucideIcon,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'スーパー管理者ダッシュボード',
};
export const dynamic = 'force-dynamic';

type Sub = {
  id: string;
  userId: string;
  planType: PlanTypeLiteral;
  interval: 'MONTH' | 'YEAR';
  status: string;
  createdAt: Date;
};

type Ord = {
  id: string;
  total: number;
  status: string;
  createdAt: Date;
};

export default async function SuperAdminDashboardPage() {
  // 並列フェッチ
  const [users, subs, orders, audits] = await Promise.all([
    prisma.user.findMany({ where: { deletedAt: null } }),
    prisma.subscription.findMany({}),
    prisma.order.findMany({}),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
  ]);

  const usersTyped = users as unknown as { createdAt: Date; deletedAt: Date | null }[];
  const subsTyped = subs as unknown as Sub[];
  const ordersTyped = orders as unknown as Ord[];
  const auditsTyped = audits as unknown as {
    id: string;
    action: string;
    resource: string | null;
    createdAt: Date;
    user?: { email: string; displayName: string | null } | null;
  }[];

  const totalUsers = usersTyped.length;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const newUsers7d = usersTyped.filter((u) => new Date(u.createdAt) >= sevenDaysAgo).length;

  const activeSubs = subsTyped.filter((s) =>
    ['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(s.status),
  );
  // MRR (月次経常収益): 月額換算
  const mrr = activeSubs.reduce((acc, s) => {
    const price = PLAN_PRICES[s.planType] ?? { monthly: 0, yearly: 0 };
    const monthly = s.interval === 'MONTH' ? price.monthly : Math.round(price.yearly / 12);
    return acc + monthly;
  }, 0);

  const paidOrders = ordersTyped.filter((o) =>
    ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(o.status),
  );
  const totalRevenue = paidOrders.reduce((acc, o) => acc + o.total, 0);

  // プラン別の内訳
  const planCount: Record<string, number> = { FREE: 0, STANDARD: 0, PREMIUM: 0 };
  for (const s of activeSubs) {
    planCount[s.planType] = (planCount[s.planType] ?? 0) + 1;
  }
  planCount.FREE = Math.max(0, totalUsers - activeSubs.length);

  const fmtJpy = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

  return (
    <main>
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">ダッシュボード</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          サイト全体の KPI・直近の動きを一目で把握。
        </p>
      </header>

      {/* KPI カード */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={Users}
          label="総会員数"
          value={totalUsers.toLocaleString()}
          sub={`+${newUsers7d} 件 (7日)`}
          accent="brand"
        />
        <KpiCard
          icon={CreditCard}
          label="有効サブスク"
          value={activeSubs.length.toLocaleString()}
          sub="TRIALING / ACTIVE / PAST_DUE"
          accent="emerald"
        />
        <KpiCard
          icon={TrendingUp}
          label="MRR (月次経常)"
          value={fmtJpy(mrr)}
          sub="月額換算"
          accent="violet"
        />
        <KpiCard
          icon={Wallet}
          label="総売上 (EC)"
          value={fmtJpy(totalRevenue)}
          sub={`${paidOrders.length} 件の決済`}
          accent="rose"
        />
      </section>

      {/* プラン構成 + 直近の監査ログ */}
      <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-900">プラン構成</h2>
          </CardHeader>
          <CardBody>
            <PlanBreakdown
              free={planCount.FREE}
              standard={planCount.STANDARD ?? 0}
              premium={planCount.PREMIUM ?? 0}
            />
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">直近の監査ログ</h2>
              <Link
                href="/super-admin/audit"
                className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 hover:text-rose-700 hover:underline"
              >
                すべて見る
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <ul className="divide-y divide-slate-100">
              {auditsTyped.length === 0 && (
                <li className="px-5 py-8 text-center text-sm text-slate-500">
                  ログはまだありません。
                </li>
              )}
              {auditsTyped.map((log) => (
                <li key={log.id} className="px-5 py-3.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{log.action}</p>
                      <p className="truncate text-xs text-slate-500">
                        {log.user?.email ?? 'system'} · {log.resource ?? '—'}
                      </p>
                    </div>
                    <span className="flex-shrink-0 text-xs text-slate-400">
                      {timeAgo(new Date(log.createdAt))}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </section>

      {/* クイックアクション */}
      <section className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-slate-900">クイックアクション</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickLink href="/super-admin/users" label="ユーザー検索" icon={Search} />
          <QuickLink href="/super-admin/subscriptions" label="サブスク一覧" icon={CreditCard} />
          <QuickLink href="/super-admin/admins" label="管理者を追加" icon={UserPlus} />
          <QuickLink href="/super-admin/audit" label="監査ログ" icon={ScrollText} />
        </div>
      </section>
    </main>
  );
}

// =============================================================
// Sub components
// =============================================================
const ACCENTS = {
  brand: {
    iconWrap: 'bg-brand-50 text-brand-600 ring-brand-100',
  },
  emerald: {
    iconWrap: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  },
  violet: {
    iconWrap: 'bg-violet-50 text-violet-600 ring-violet-100',
  },
  rose: {
    iconWrap: 'bg-rose-50 text-rose-600 ring-rose-100',
  },
} as const;

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
  accent: keyof typeof ACCENTS;
}) {
  const a = ACCENTS[accent];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            {label}
          </p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900 sm:text-3xl">
            {value}
          </p>
        </div>
        <span
          className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${a.iconWrap}`}
        >
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      </div>
      <p className="mt-3 text-xs text-slate-500">{sub}</p>
    </div>
  );
}

function PlanBreakdown({
  free,
  standard,
  premium,
}: {
  free: number;
  standard: number;
  premium: number;
}) {
  const total = Math.max(1, free + standard + premium);
  const pct = (n: number) => Math.round((n / total) * 100);

  return (
    <div className="space-y-4">
      {[
        { label: 'FREE', count: free, pct: pct(free), color: 'bg-slate-400' },
        {
          label: 'STANDARD',
          count: standard,
          pct: pct(standard),
          color: 'bg-amber-500',
        },
        {
          label: 'PREMIUM',
          count: premium,
          pct: pct(premium),
          color: 'bg-rose-500',
        },
      ].map((row) => (
        <div key={row.label}>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-700">{row.label}</span>
            <span className="text-slate-500 tabular-nums">
              {row.count} 名 ({row.pct}%)
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all ${row.color}`}
              style={{ width: `${row.pct}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function QuickLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm transition-all hover:-translate-y-0.5 hover:border-rose-300 hover:shadow-md"
    >
      <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500 transition-colors group-hover:bg-rose-50 group-hover:text-rose-600">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="font-medium text-slate-700 group-hover:text-rose-700">{label}</span>
    </Link>
  );
}

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'たった今';
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24);
  return `${d}日前`;
}
