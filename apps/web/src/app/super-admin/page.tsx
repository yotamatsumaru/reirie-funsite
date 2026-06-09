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
import { Badge } from '@/components/ui/Badge';
import Link from 'next/link';
import { PLAN_PRICES, type PlanTypeLiteral } from '@idol/shared';

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
      <header className="mb-6">
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">ダッシュボード</h1>
        <p className="mt-1 text-sm text-slate-500">サイト全体の KPI・直近の動きを一目で把握。</p>
      </header>

      {/* KPI カード */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          label="総会員数"
          value={totalUsers.toLocaleString()}
          sub={`+${newUsers7d} 件 (7日)`}
          accent="brand"
        />
        <KpiCard
          label="有効サブスク"
          value={activeSubs.length.toLocaleString()}
          sub={`TRIALING / ACTIVE / PAST_DUE`}
          accent="emerald"
        />
        <KpiCard
          label="MRR (月次経常)"
          value={fmtJpy(mrr)}
          sub="月額換算"
          accent="violet"
        />
        <KpiCard
          label="総売上 (EC)"
          value={fmtJpy(totalRevenue)}
          sub={`${paidOrders.length} 件の決済`}
          accent="rose"
        />
      </section>

      {/* プラン構成 */}
      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-800">プラン構成</h2>
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
              <h2 className="text-sm font-semibold text-slate-800">直近の監査ログ</h2>
              <Link
                href="/super-admin/audit"
                className="text-xs text-rose-600 hover:underline"
              >
                すべて見る →
              </Link>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <ul className="divide-y divide-slate-100">
              {auditsTyped.length === 0 && (
                <li className="px-5 py-6 text-center text-sm text-slate-500">
                  ログはまだありません。
                </li>
              )}
              {auditsTyped.map((log) => (
                <li key={log.id} className="px-5 py-3 text-sm">
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
      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">クイックアクション</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <QuickLink href="/super-admin/users" label="ユーザー検索" icon="🔍" />
          <QuickLink href="/super-admin/subscriptions" label="サブスク一覧" icon="💳" />
          <QuickLink href="/super-admin/admins" label="管理者を追加" icon="🛡️" />
          <QuickLink href="/super-admin/audit" label="監査ログ" icon="📜" />
        </div>
      </section>
    </main>
  );
}

// =============================================================
// Sub components
// =============================================================
const ACCENTS = {
  brand: 'from-brand-50 to-brand-100 text-brand-700 ring-brand-200',
  emerald: 'from-emerald-50 to-emerald-100 text-emerald-700 ring-emerald-200',
  violet: 'from-violet-50 to-violet-100 text-violet-700 ring-violet-200',
  rose: 'from-rose-50 to-rose-100 text-rose-700 ring-rose-200',
};

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent: keyof typeof ACCENTS;
}) {
  return (
    <div
      className={`rounded-lg bg-gradient-to-br p-4 ring-1 sm:p-5 ${ACCENTS[accent]}`}
    >
      <p className="text-xs font-semibold opacity-80">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums sm:text-3xl">{value}</p>
      <p className="mt-1 text-xs opacity-70">{sub}</p>
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
    <div className="space-y-3">
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
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700">{row.label}</span>
            <span className="text-slate-500">
              {row.count} 名 ({row.pct}%)
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full ${row.color}`}
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
  icon,
}: {
  href: string;
  label: string;
  icon: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 transition-colors hover:border-rose-300 hover:text-rose-700"
    >
      <span className="text-lg">{icon}</span>
      <span className="font-medium">{label}</span>
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
