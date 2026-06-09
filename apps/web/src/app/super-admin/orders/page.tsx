/**
 * /super-admin/orders — 全注文一覧 + 日次・月次集計 + 返金処理
 */
import { prisma } from '@idol/db';
import type { Metadata } from 'next';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ORDER_STATUS_LABELS } from '@idol/shared';
import { OrderRowActions } from './order-row-actions';

export const metadata: Metadata = { title: '注文・売上管理 | Super Admin' };
export const dynamic = 'force-dynamic';

type OrderRow = {
  id: string;
  orderNumber: string;
  userId: string;
  status: keyof typeof ORDER_STATUS_LABELS;
  subtotal: number;
  shippingFee: number;
  taxAmount: number;
  totalAmount: number;
  createdAt: Date;
  trackingNumber: string | null;
  user?: { id: string; email: string; displayName: string | null } | null;
  items?: { id: string; productName: string; variantName: string; quantity: number; subtotal: number }[];
};

export default async function SuperAdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const statusFilter = sp.status ?? '';
  const q = sp.q?.trim() ?? '';

  const orders = (await prisma.order.findMany({})) as unknown as OrderRow[];

  const filtered = orders.filter((o) => {
    if (statusFilter && o.status !== statusFilter) return false;
    if (q) {
      const needle = q.toLowerCase();
      const hay = [o.orderNumber, o.user?.email ?? '', o.user?.displayName ?? '']
        .join(' ')
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  // 集計
  const paid = orders.filter((o) =>
    ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(o.status),
  );
  const refunded = orders.filter((o) => o.status === 'REFUNDED');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const totalRevenue = paid.reduce((a, o) => a + o.totalAmount, 0);
  const todayRevenue = paid
    .filter((o) => new Date(o.createdAt) >= today)
    .reduce((a, o) => a + o.totalAmount, 0);
  const monthRevenue = paid
    .filter((o) => new Date(o.createdAt) >= thisMonth)
    .reduce((a, o) => a + o.totalAmount, 0);
  const refundAmount = refunded.reduce((a, o) => a + o.totalAmount, 0);

  // 直近 14 日の売上(日次)
  const days = 14;
  const dailySeries: { date: Date; amount: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const nextD = new Date(d);
    nextD.setDate(nextD.getDate() + 1);
    const amount = paid
      .filter((o) => {
        const c = new Date(o.createdAt);
        return c >= d && c < nextD;
      })
      .reduce((a, o) => a + o.totalAmount, 0);
    dailySeries.push({ date: d, amount });
  }
  const maxDaily = Math.max(1, ...dailySeries.map((s) => s.amount));

  const fmtJpy = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

  return (
    <main>
      <header className="mb-5">
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">注文・売上管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          EC 注文一覧・売上集計・返金処理を行います。
        </p>
      </header>

      {/* KPI */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Kpi label="本日の売上" value={fmtJpy(todayRevenue)} accent="brand" />
        <Kpi label="今月の売上" value={fmtJpy(monthRevenue)} accent="emerald" />
        <Kpi label="累計売上" value={fmtJpy(totalRevenue)} accent="violet" />
        <Kpi label="返金累計" value={fmtJpy(refundAmount)} accent="rose" />
      </section>

      {/* 日次グラフ */}
      <Card className="mt-6">
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-800">直近 {days} 日の日次売上</h2>
        </CardHeader>
        <CardBody>
          <div className="flex items-end gap-1 h-32">
            {dailySeries.map((s) => {
              const h = Math.max(4, Math.round((s.amount / maxDaily) * 100));
              return (
                <div key={s.date.toISOString()} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className={`w-full rounded-t ${s.amount > 0 ? 'bg-brand-500' : 'bg-slate-200'}`}
                    style={{ height: `${h}%` }}
                    title={`${s.date.toLocaleDateString('ja-JP')}: ${fmtJpy(s.amount)}`}
                  />
                  <span className="text-[10px] text-slate-400">
                    {s.date.getMonth() + 1}/{s.date.getDate()}
                  </span>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* フィルタ */}
      <Card className="mt-6 mb-4">
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                キーワード (注文番号 / Email)
              </label>
              <input
                name="q"
                defaultValue={q}
                placeholder="例: ORD-20260606 or fan01@..."
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                ステータス
              </label>
              <select
                name="status"
                defaultValue={statusFilter}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">すべて</option>
                {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
            >
              絞り込み
            </button>
          </form>
        </CardBody>
      </Card>

      {/* テーブル */}
      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">注文番号</th>
                  <th className="px-4 py-3">購入者</th>
                  <th className="px-4 py-3">商品</th>
                  <th className="px-4 py-3 text-right">合計</th>
                  <th className="px-4 py-3">ステータス</th>
                  <th className="px-4 py-3">日時</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                      該当する注文がありません。
                    </td>
                  </tr>
                )}
                {filtered.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      {o.orderNumber}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <p className="font-medium text-slate-900">
                        {o.user?.displayName ?? '—'}
                      </p>
                      <p className="text-slate-500">{o.user?.email ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {o.items && o.items.length > 0 ? (
                        <>
                          <p className="text-slate-700">
                            {o.items[0]!.productName}
                            {o.items.length > 1 && (
                              <span className="text-slate-400">
                                {' '}
                                +{o.items.length - 1}件
                              </span>
                            )}
                          </p>
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-slate-900">
                      {fmtJpy(o.totalAmount)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-600">
                      {new Date(o.createdAt).toLocaleDateString('ja-JP', {
                        month: '2-digit',
                        day: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <OrderRowActions orderId={o.id} status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </main>
  );
}

function Kpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: 'brand' | 'emerald' | 'violet' | 'rose';
}) {
  const colors = {
    brand: 'from-brand-50 to-brand-100 text-brand-700 ring-brand-200',
    emerald: 'from-emerald-50 to-emerald-100 text-emerald-700 ring-emerald-200',
    violet: 'from-violet-50 to-violet-100 text-violet-700 ring-violet-200',
    rose: 'from-rose-50 to-rose-100 text-rose-700 ring-rose-200',
  };
  return (
    <div className={`rounded-lg bg-gradient-to-br p-4 ring-1 sm:p-5 ${colors[accent]}`}>
      <p className="text-xs font-semibold opacity-80">{label}</p>
      <p className="mt-2 text-xl font-bold tabular-nums sm:text-2xl">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: keyof typeof ORDER_STATUS_LABELS }) {
  const label = ORDER_STATUS_LABELS[status] ?? status;
  if (status === 'PAID') return <Badge tone="info">{label}</Badge>;
  if (status === 'PROCESSING') return <Badge tone="warning">{label}</Badge>;
  if (status === 'SHIPPED' || status === 'DELIVERED')
    return <Badge tone="success">{label}</Badge>;
  if (status === 'REFUNDED' || status === 'CANCELED')
    return <Badge tone="danger">{label}</Badge>;
  return <Badge tone="gray">{label}</Badge>;
}
