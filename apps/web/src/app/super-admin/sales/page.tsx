/**
 * /super-admin/sales — 売上管理ダッシュボード (SUPER_ADMIN 限定)
 *
 * Payment テーブルを基準に、サブスク課金 / EC注文 / チケット代 を横断した
 * 売上を集計する。/super-admin/orders (EC注文管理) とは別に、
 * 「決済の種類を問わない全社売上」を一目で把握できる画面として提供する。
 *
 *  - KPI: 本日 / 今月 / 累計 の売上 (成功した決済のみ)
 *  - 売上種別 (サブスク / EC注文 / チケット代) ごとの内訳
 *  - 直近 14 日間の日次売上グラフ
 *  - 決済一覧 (種別・状態・キーワードで絞り込み可能) + CSV エクスポート
 */
import { prisma } from '@idol/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import {
  PAYMENT_KIND_LABELS,
  PAYMENT_STATUS_LABELS,
  type PlanTypeLiteral,
} from '@idol/shared';
import { Download } from 'lucide-react';

export const metadata: Metadata = { title: '売上管理 | Super Admin' };
export const dynamic = 'force-dynamic';

// 集計対象として一度に読み込む決済件数の上限 (メモリ・応答時間の保護)。
// 他の集計系ページ (super-admin/orders 等) と同様、DEMO_MODE でも動作するよう
// 集計は JS 側で行う設計を保ったまま、件数だけ安全に上限を設ける。
const FETCH_LIMIT = 10000;

type PaymentKindKey = keyof typeof PAYMENT_KIND_LABELS;
type PaymentStatusKey = keyof typeof PAYMENT_STATUS_LABELS;

type PaymentRow = {
  id: string;
  userId: string;
  kind: PaymentKindKey;
  status: PaymentStatusKey;
  amount: number;
  currency: string;
  subscriptionId: string | null;
  orderId: string | null;
  createdAt: Date;
  user?: { id: string; email: string; displayName: string | null } | null;
  order?: { orderNumber: string } | null;
  subscription?: { planType: PlanTypeLiteral } | null;
};

export default async function SuperAdminSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; status?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const kindFilter = sp.kind ?? '';
  const statusFilter = sp.status ?? '';
  const q = sp.q?.trim() ?? '';

  const [payments, totalPaymentCount] = await Promise.all([
    prisma.payment.findMany({
      include: {
        user: { select: { id: true, email: true, displayName: true } },
        order: { select: { orderNumber: true } },
        subscription: { select: { planType: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: FETCH_LIMIT,
    }) as unknown as Promise<PaymentRow[]>,
    prisma.payment.count({}),
  ]);
  // 件数が上限に達している場合、累計 KPI は「直近 FETCH_LIMIT 件」のみを反映した近似値になる。
  const isTruncated = totalPaymentCount > payments.length;

  const filtered = payments.filter((p) => {
    if (kindFilter && p.kind !== kindFilter) return false;
    if (statusFilter && p.status !== statusFilter) return false;
    if (q) {
      const needle = q.toLowerCase();
      const hay = [p.user?.email ?? '', p.user?.displayName ?? '', p.order?.orderNumber ?? '']
        .join(' ')
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  // ===== 集計 (成功した決済のみを「売上」として扱う) =====
  const succeeded = payments.filter((p) => p.status === 'SUCCEEDED');
  const refunded = payments.filter((p) => p.status === 'REFUNDED');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const sumAmount = (rows: PaymentRow[]) => rows.reduce((a, p) => a + p.amount, 0);

  const totalRevenue = sumAmount(succeeded);
  const todayRevenue = sumAmount(succeeded.filter((p) => new Date(p.createdAt) >= today));
  const monthRevenue = sumAmount(succeeded.filter((p) => new Date(p.createdAt) >= thisMonth));
  const refundAmount = sumAmount(refunded);

  // 種別ごとの内訳 (累計・成功分)
  const kindBreakdown: Record<PaymentKindKey, { amount: number; count: number }> = {
    SUBSCRIPTION: { amount: 0, count: 0 },
    ONE_TIME_ORDER: { amount: 0, count: 0 },
    TICKET_FEE: { amount: 0, count: 0 },
  };
  for (const p of succeeded) {
    kindBreakdown[p.kind].amount += p.amount;
    kindBreakdown[p.kind].count += 1;
  }

  // 直近 14 日の日次売上
  const days = 14;
  const dailySeries: { date: Date; amount: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const nextD = new Date(d);
    nextD.setDate(nextD.getDate() + 1);
    const amount = sumAmount(
      succeeded.filter((p) => {
        const c = new Date(p.createdAt);
        return c >= d && c < nextD;
      }),
    );
    dailySeries.push({ date: d, amount });
  }
  const maxDaily = Math.max(1, ...dailySeries.map((s) => s.amount));

  const fmtJpy = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

  const exportQuery = new URLSearchParams();
  if (kindFilter) exportQuery.set('kind', kindFilter);
  if (statusFilter) exportQuery.set('status', statusFilter);
  if (q) exportQuery.set('q', q);
  const exportHref = `/api/super-admin/sales/export${
    exportQuery.toString() ? `?${exportQuery.toString()}` : ''
  }`;

  return (
    <main>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">売上管理</h1>
          <p className="mt-1 text-sm text-slate-500">
            サブスク課金・EC注文・チケット代を横断した全社売上を集計します。
          </p>
        </div>
        <a
          href={exportHref}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          CSV エクスポート
        </a>
      </header>

      {isTruncated && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          決済件数が {totalPaymentCount.toLocaleString()} 件と多いため、直近 {FETCH_LIMIT.toLocaleString()}{' '}
          件のみを対象に集計しています。累計 KPI は近似値です (全件は CSV エクスポートで取得できます)。
        </p>
      )}

      {/* KPI */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Kpi label="本日の売上" value={fmtJpy(todayRevenue)} accent="brand" />
        <Kpi label="今月の売上" value={fmtJpy(monthRevenue)} accent="emerald" />
        <Kpi label="累計売上" value={fmtJpy(totalRevenue)} accent="violet" />
        <Kpi label="返金累計" value={fmtJpy(refundAmount)} accent="rose" />
      </section>

      {/* 種別ごとの内訳 */}
      <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(Object.keys(PAYMENT_KIND_LABELS) as PaymentKindKey[]).map((kind) => (
          <Card key={kind}>
            <CardBody>
              <p className="text-xs font-semibold text-slate-500">{PAYMENT_KIND_LABELS[kind]}</p>
              <p className="mt-1.5 text-lg font-bold tabular-nums text-slate-900">
                {fmtJpy(kindBreakdown[kind].amount)}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">{kindBreakdown[kind].count} 件</p>
            </CardBody>
          </Card>
        ))}
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
                キーワード (Email / 表示名 / 注文番号)
              </label>
              <input
                name="q"
                defaultValue={q}
                placeholder="例: fan01@... or ORD-20260606"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">種別</label>
              <select
                name="kind"
                defaultValue={kindFilter}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">すべて</option>
                {Object.entries(PAYMENT_KIND_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">状態</label>
              <select
                name="status"
                defaultValue={statusFilter}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">すべて</option>
                {Object.entries(PAYMENT_STATUS_LABELS).map(([k, v]) => (
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
                  <th className="px-4 py-3">購入者</th>
                  <th className="px-4 py-3">種別</th>
                  <th className="px-4 py-3">内容</th>
                  <th className="px-4 py-3 text-right">金額</th>
                  <th className="px-4 py-3">状態</th>
                  <th className="px-4 py-3">日時</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                      該当する決済がありません。
                    </td>
                  </tr>
                )}
                {filtered.slice(0, 200).map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-xs">
                      <p className="font-medium text-slate-900">{p.user?.displayName ?? '—'}</p>
                      <p className="text-slate-500">{p.user?.email ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <KindBadge kind={p.kind} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {p.kind === 'ONE_TIME_ORDER' && p.order?.orderNumber
                        ? p.order.orderNumber
                        : p.kind === 'SUBSCRIPTION' && p.subscription?.planType
                          ? `${p.subscription.planType} プラン`
                          : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-slate-900">
                      {fmtJpy(p.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-600">
                      {new Date(p.createdAt).toLocaleDateString('ja-JP', {
                        month: '2-digit',
                        day: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 200 && (
            <p className="border-t border-slate-100 px-4 py-3 text-center text-xs text-slate-400">
              最新 200 件のみ表示しています。全件は CSV エクスポートをご利用ください。
            </p>
          )}
        </CardBody>
      </Card>

      <p className="mt-4 text-xs text-slate-400">
        EC 注文の発送・返金処理は{' '}
        <Link href="/super-admin/orders" className="text-rose-600 hover:underline">
          注文・売上管理
        </Link>{' '}
        で行えます。
      </p>
    </main>
  );
}

// =============================================================
// Sub components
// =============================================================
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

function KindBadge({ kind }: { kind: PaymentKindKey }) {
  const label = PAYMENT_KIND_LABELS[kind] ?? kind;
  if (kind === 'SUBSCRIPTION') return <Badge tone="info">{label}</Badge>;
  if (kind === 'ONE_TIME_ORDER') return <Badge tone="brand">{label}</Badge>;
  return <Badge tone="warning">{label}</Badge>;
}

function StatusBadge({ status }: { status: PaymentStatusKey }) {
  const label = PAYMENT_STATUS_LABELS[status] ?? status;
  if (status === 'SUCCEEDED') return <Badge tone="success">{label}</Badge>;
  if (status === 'PENDING') return <Badge tone="warning">{label}</Badge>;
  if (status === 'FAILED' || status === 'REFUNDED') return <Badge tone="danger">{label}</Badge>;
  return <Badge tone="gray">{label}</Badge>;
}
