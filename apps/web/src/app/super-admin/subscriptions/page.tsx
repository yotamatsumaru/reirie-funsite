/**
 * /super-admin/subscriptions — 全契約一覧 / フィルタ / 強制解約
 */
import { prisma } from '@idol/db';
import type { Metadata } from 'next';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PLAN_LABELS, type PlanTypeLiteral } from '@idol/shared';
import { SubRowActions } from './sub-row-actions';

export const metadata: Metadata = { title: 'サブスク管理 | Super Admin' };
export const dynamic = 'force-dynamic';

type SubRow = {
  id: string;
  userId: string;
  planType: PlanTypeLiteral;
  interval: 'MONTH' | 'YEAR';
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  createdAt: Date;
  user?: { id: string; email: string; displayName: string | null } | null;
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: '有効',
  TRIALING: 'トライアル',
  PAST_DUE: '支払遅延',
  CANCELED: 'キャンセル済',
  UNPAID: '未払い',
  INCOMPLETE: '未完了',
  INCOMPLETE_EXPIRED: '期限切れ',
};

export default async function SuperAdminSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; plan?: string }>;
}) {
  const sp = await searchParams;
  const statusFilter = sp.status ?? '';
  const planFilter = sp.plan ?? '';

  const subs = (await prisma.subscription.findMany({})) as unknown as SubRow[];
  const filtered = subs.filter((s) => {
    if (statusFilter && s.status !== statusFilter) return false;
    if (planFilter && s.planType !== planFilter) return false;
    return true;
  });

  // サマリ
  const counts: Record<string, number> = {};
  for (const s of subs) counts[s.status] = (counts[s.status] ?? 0) + 1;

  return (
    <main>
      <header className="mb-5">
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">サブスクリプション管理</h1>
        <p className="mt-1 text-sm text-slate-500">
          全 {subs.length} 件 / 表示中 {filtered.length} 件
        </p>
      </header>

      {/* サマリ */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {['ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED'].map((st) => (
          <div
            key={st}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <p className="text-xs text-slate-500">{STATUS_LABELS[st] ?? st}</p>
            <p className="mt-0.5 text-xl font-bold text-slate-900">{counts[st] ?? 0}</p>
          </div>
        ))}
      </div>

      {/* フィルタ */}
      <Card className="mb-4">
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">プラン</label>
              <select
                name="plan"
                defaultValue={planFilter}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">すべて</option>
                <option value="STANDARD">STANDARD</option>
                <option value="PREMIUM">PREMIUM</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">ステータス</label>
              <select
                name="status"
                defaultValue={statusFilter}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">すべて</option>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
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
                  <th className="px-4 py-3">契約者</th>
                  <th className="px-4 py-3">プラン</th>
                  <th className="px-4 py-3">期間</th>
                  <th className="px-4 py-3">ステータス</th>
                  <th className="px-4 py-3">次回更新</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                      該当する契約がありません。
                    </td>
                  </tr>
                )}
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">
                        {s.user?.displayName ?? '（不明）'}
                      </p>
                      <p className="text-xs text-slate-500">{s.user?.email ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={s.planType === 'PREMIUM' ? 'danger' : 'warning'}>
                        {PLAN_LABELS[s.planType]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {s.interval === 'MONTH' ? '月額' : '年額'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={s.status} />
                      {s.cancelAtPeriodEnd && (
                        <span className="ml-1 text-xs text-amber-600">
                          (期末解約予約)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {formatDate(new Date(s.currentPeriodEnd))}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <SubRowActions
                        subId={s.id}
                        status={s.status}
                        cancelAtPeriodEnd={s.cancelAtPeriodEnd}
                      />
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

function StatusBadge({ status }: { status: string }) {
  if (status === 'ACTIVE') return <Badge tone="success">{STATUS_LABELS[status]}</Badge>;
  if (status === 'TRIALING') return <Badge tone="info">{STATUS_LABELS[status]}</Badge>;
  if (status === 'PAST_DUE') return <Badge tone="warning">{STATUS_LABELS[status]}</Badge>;
  if (status === 'CANCELED') return <Badge tone="gray">{STATUS_LABELS[status]}</Badge>;
  return <Badge tone="gray">{STATUS_LABELS[status] ?? status}</Badge>;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
