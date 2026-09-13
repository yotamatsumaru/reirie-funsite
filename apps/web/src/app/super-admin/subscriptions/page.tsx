/**
 * /super-admin/subscriptions — サブスク分析 + 全契約一覧 / 強制解約
 *
 * 「追加/管理」よりも現状の加入率・離脱などを把握することを主目的とした分析ビュー。
 *  ① KPI カード（有効契約数 / 今月の新規加入 / 今月の解約 / 月次チャーン率）
 *  ② プラン別内訳（STANDARD / PREMIUM の件数・構成比・推定 MRR）
 *  ③ 加入・離脱の推移（直近 12 ヶ月の簡易バー）
 *  ④ 継続率・離脱予備軍（期末解約予約中の件数）
 * 下部に従来の契約一覧テーブル（強制解約操作つき）を維持する。
 */
import type { Metadata } from 'next';
import { auth } from '@/auth';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PLAN_LABELS, type PlanTypeLiteral } from '@idol/shared';
import { SubRowActions } from './sub-row-actions';
import { ReconcileButton } from './reconcile-button';
import { SubscriptionHealthPanel } from './health-panel';
import {
  LIVE_STATUSES as LIVE_STATUSES_ARR,
  getSubscriptionAnalytics,
  listSubscriptionsPage,
} from '@/lib/subscription-analytics';

export const metadata: Metadata = { title: 'サブスク分析 | Super Admin' };
export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: '有効',
  TRIALING: 'トライアル',
  PAST_DUE: '支払遅延',
  CANCELED: 'キャンセル済',
  UNPAID: '未払い',
  INCOMPLETE: '未完了',
  INCOMPLETE_EXPIRED: '期限切れ',
};

/** 有効（=売上に寄与している）とみなすステータス */
const LIVE_STATUSES = new Set<string>(LIVE_STATUSES_ARR);

/** 支払い未完了（=権限が付与されない）ステータス */
const INCOMPLETE_STATUSES = new Set(['INCOMPLETE', 'INCOMPLETE_EXPIRED']);

/** 契約一覧テーブルの1ページあたり表示件数 */
const PAGE_SIZE = 30;

function ymLabel(key: string): string {
  const [, m] = key.split('-');
  return `${Number(m)}月`;
}

export default async function SuperAdminSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; plan?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const statusFilter = sp.status ?? '';
  const planFilter = sp.plan ?? '';
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  // スタッフ管理者は閲覧のみ (返金/解約/再照合などの書き込み操作は不可)
  const session = await auth();
  const readOnly = session?.user?.role === 'STAFF';

  const now = new Date();

  // ---------------------------------------------------------------------------
  // ① 〜 ④ の分析 (KPI / プラン別内訳 / 12ヶ月推移 / 継続率) は、
  //    契約テーブルの全行を読み込まず DB 側の groupBy / count / 生SQL集計で行う
  //    (詳細は lib/subscription-analytics.ts を参照)。
  // ---------------------------------------------------------------------------
  const analytics = await getSubscriptionAnalytics(now);
  const {
    kpis: { activeCount, newThisMonth, churnedThisMonth, activeAtMonthStart, churnRate },
    planStats,
    totalMrr,
    trend: trendPoints,
    scheduledCancels,
    duplicateUsers,
    statusCounts,
    refundedCount,
    totalSubscriptionCount,
    refundedSubIds,
    duplicateUserIds,
  } = analytics;

  const trend: Record<string, { joins: number; churns: number }> = {};
  const months: string[] = [];
  for (const p of trendPoints) {
    months.push(p.key);
    trend[p.key] = { joins: p.joins, churns: p.churns };
  }
  const maxTrend = Math.max(1, ...months.map((m) => Math.max(trend[m].joins, trend[m].churns)));

  // ---------------------------------------------------------------------------
  // 下部「契約一覧 / 操作」テーブル: ステータス・プランで DB レベルに絞り込み、
  // ページング取得する (分析目的ではなく操作目的のテーブルのため)。
  // 返金済み判定 / 重複ユーザー判定は analytics で既に計算済みの集合を
  // 再利用する (二重にクエリを発行しない)。
  // ---------------------------------------------------------------------------
  const { rows: filtered, total: filteredTotal } = await listSubscriptionsPage({
    statusFilter,
    planFilter,
    page,
    pageSize: PAGE_SIZE,
    refundedSubIds,
    duplicateUserIds,
  });
  const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));

  const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
  const pct = (n: number) => `${n.toFixed(1)}%`;

  return (
    <main>
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">サブスク分析</h1>
          <p className="mt-1 text-sm text-slate-500">
            現在の加入状況・離脱・推移を把握するためのダッシュボードです（全 {totalSubscriptionCount.toLocaleString('ja-JP')} 件）。
          </p>
          <p className="mt-1 text-xs text-slate-400">
            売上には出ているのに件数が合わない場合は「Stripe と再照合」で最新化できます。
          </p>
        </div>
        {!readOnly && <ReconcileButton />}
      </header>

      {/*
        プラン反映の不整合チェック
          「決済は成功しているのにプランが反映されていない会員」を、
          会員からの申告を待たずに運営側から発見するためのパネル。
          最優先で気づくべき事象のため、分析KPIより前に置く。
      */}
      <div className="mb-6">
        <SubscriptionHealthPanel />
      </div>

      {/* 二重契約の警告バナー */}
      {duplicateUsers.length > 0 && (
        <div className="mb-6 rounded-md border border-rose-300 bg-rose-50 px-4 py-3">
          <p className="text-sm font-bold text-rose-800">
            ⚠ 二重契約の可能性があるユーザーが {duplicateUsers.length} 名います
          </p>
          <p className="mt-1 text-xs text-rose-700">
            同一ユーザーに有効なサブスクリプションが 2 件以上あります。プラン反映の遅延などで
            重複購入された可能性があります。下記の契約一覧で
            <span className="mx-1 rounded bg-rose-200 px-1 font-semibold">重複</span>
            マークの付いた契約を確認し、不要な方を「即時解約」してください（返金が必要な場合は各契約の「返金」から対応できます）。
          </p>
          <ul className="mt-2 space-y-1">
            {duplicateUsers.map((d) => (
              <li key={d.userId} className="text-xs text-rose-800">
                ・{d.displayName}（{d.email}）—{' '}
                <span className="font-bold">{d.count} 件</span>の有効契約
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ① KPI カード */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="有効契約数"
          value={activeCount.toLocaleString('ja-JP')}
          sub="ACTIVE + トライアル"
          tone="rose"
        />
        <KpiCard
          label="今月の新規加入"
          value={`+${newThisMonth.toLocaleString('ja-JP')}`}
          sub={`${now.getMonth() + 1}月 加入`}
          tone="emerald"
        />
        <KpiCard
          label="今月の解約（離脱）"
          value={`-${churnedThisMonth.toLocaleString('ja-JP')}`}
          sub={`${now.getMonth() + 1}月 解約`}
          tone="amber"
        />
        <KpiCard
          label="月次チャーン率"
          value={pct(churnRate)}
          sub={`月初有効 ${activeAtMonthStart} 件 基準`}
          tone="slate"
        />
      </div>

      {/* ② プラン別内訳 */}
      <Card className="mb-6">
        <CardBody>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-bold text-slate-900">プラン別内訳（有効契約）</h2>
            <p className="text-xs text-slate-500">
              推定 MRR（月次換算売上）合計{' '}
              <span className="font-bold text-slate-900">{yen(totalMrr)}</span>
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['STANDARD', 'PREMIUM'] as const).map((plan) => {
              const st = planStats[plan];
              const share = activeCount > 0 ? (st.count / activeCount) * 100 : 0;
              return (
                <div
                  key={plan}
                  className="rounded-md border border-slate-200 bg-white p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <Badge tone={plan === 'PREMIUM' ? 'danger' : 'warning'}>
                      {PLAN_LABELS[plan]}
                    </Badge>
                    <span className="text-lg font-bold text-slate-900">
                      {st.count} 件
                    </span>
                  </div>
                  <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={
                        plan === 'PREMIUM' ? 'h-full bg-rose-500' : 'h-full bg-amber-500'
                      }
                      style={{ width: `${share}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>構成比 {pct(share)}</span>
                    <span>
                      月額 {st.monthCount} / 年額 {st.yearCount}
                    </span>
                    <span className="font-semibold text-slate-700">MRR {yen(st.mrr)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* ③ 加入・離脱の推移 */}
      <Card className="mb-6">
        <CardBody>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">加入・離脱の推移（直近12ヶ月）</h2>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500" /> 新規加入
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-amber-500" /> 解約
              </span>
            </div>
          </div>
          <div className="flex items-end gap-1.5 overflow-x-auto pb-1 sm:gap-2">
            {months.map((m) => {
              const t = trend[m];
              return (
                <div key={m} className="flex min-w-[42px] flex-1 flex-col items-center">
                  <div className="flex h-28 w-full items-end justify-center gap-0.5">
                    <div
                      className="w-1/2 rounded-t bg-emerald-500"
                      style={{ height: `${(t.joins / maxTrend) * 100}%` }}
                      title={`新規 ${t.joins} 件`}
                    />
                    <div
                      className="w-1/2 rounded-t bg-amber-500"
                      style={{ height: `${(t.churns / maxTrend) * 100}%` }}
                      title={`解約 ${t.churns} 件`}
                    />
                  </div>
                  <span className="mt-1 text-[10px] text-slate-500">{ymLabel(m)}</span>
                  <span className="text-[10px] font-semibold text-slate-700">
                    +{t.joins}/-{t.churns}
                  </span>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      {/* ④ 離脱予備軍 */}
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs font-semibold text-amber-700">期末解約予約中（離脱予備軍）</p>
          <p className="mt-0.5 text-2xl font-bold text-amber-800">
            {scheduledCancels} 件
          </p>
          <p className="mt-0.5 text-xs text-amber-600">
            現在は有効ですが、期末で解約予定の契約です。
          </p>
        </div>
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-semibold text-slate-500">ステータス別（全期間）</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            {['ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED'].map((st) => (
              <span key={st}>
                {STATUS_LABELS[st]}:{' '}
                <span className="font-bold text-slate-900">{statusCounts[st] ?? 0}</span>
              </span>
            ))}
            {refundedCount > 0 && (
              <span>
                返金済み: <span className="font-bold text-emerald-700">{refundedCount}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ================= 契約一覧（管理・操作） ================= */}
      <header className="mb-3">
        <h2 className="text-lg font-bold text-slate-900">契約一覧 / 操作</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          全 {totalSubscriptionCount.toLocaleString('ja-JP')} 件 / 表示中{' '}
          {filteredTotal.toLocaleString('ja-JP')} 件
        </p>
      </header>

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
                  <tr
                    key={s.id}
                    className={
                      s.refunded
                        ? 'bg-emerald-50/60 hover:bg-emerald-50'
                        : s.duplicateLive
                          ? 'bg-rose-50 hover:bg-rose-100'
                          : INCOMPLETE_STATUSES.has(s.status)
                            ? 'bg-slate-50 text-slate-400 hover:bg-slate-100'
                            : 'hover:bg-slate-50'
                    }
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <p
                          className={
                            INCOMPLETE_STATUSES.has(s.status)
                              ? 'font-medium text-slate-400'
                              : 'font-medium text-slate-900'
                          }
                        >
                          {s.user?.displayName ?? '（不明）'}
                        </p>
                        {s.refunded ? (
                          <span
                            className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700"
                            title="この契約の課金は返金済みです"
                          >
                            返金済み
                          </span>
                        ) : (
                          s.duplicateLive && (
                            <span
                              className="rounded bg-rose-200 px-1.5 py-0.5 text-[10px] font-bold text-rose-800"
                              title="このユーザーは有効な契約を複数持っています（二重契約の可能性）"
                            >
                              重複
                            </span>
                          )
                        )}
                      </div>
                      <p className="text-xs text-slate-400">{s.user?.email ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      {INCOMPLETE_STATUSES.has(s.status) ? (
                        <Badge tone="gray">{PLAN_LABELS[s.planType]}</Badge>
                      ) : (
                        <Badge tone={s.planType === 'PREMIUM' ? 'danger' : 'warning'}>
                          {PLAN_LABELS[s.planType]}
                        </Badge>
                      )}
                    </td>
                    <td
                      className={
                        INCOMPLETE_STATUSES.has(s.status)
                          ? 'px-4 py-3 text-xs text-slate-400'
                          : 'px-4 py-3 text-xs text-slate-600'
                      }
                    >
                      {s.billingInterval === 'MONTH' ? '月額' : '年額'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={s.status} />
                      {INCOMPLETE_STATUSES.has(s.status) && (
                        <p className="mt-1 text-[11px] font-medium text-slate-400">
                          支払い未完了・権限なし
                        </p>
                      )}
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
                        readOnly={readOnly}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* ページング */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
          <p>
            {filteredTotal.toLocaleString('ja-JP')} 件中{' '}
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredTotal)} 件
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <a
                href={`/super-admin/subscriptions?${new URLSearchParams({
                  ...(statusFilter ? { status: statusFilter } : {}),
                  ...(planFilter ? { plan: planFilter } : {}),
                  page: String(page - 1),
                })}`}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
              >
                前へ
              </a>
            )}
            <span className="px-2 py-1.5">
              {page} / {totalPages}
            </span>
            {page < totalPages && (
              <a
                href={`/super-admin/subscriptions?${new URLSearchParams({
                  ...(statusFilter ? { status: statusFilter } : {}),
                  ...(planFilter ? { plan: planFilter } : {}),
                  page: String(page + 1),
                })}`}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50"
              >
                次へ
              </a>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'rose' | 'emerald' | 'amber' | 'slate';
}) {
  const toneMap: Record<string, string> = {
    rose: 'border-rose-200 bg-rose-50',
    emerald: 'border-emerald-200 bg-emerald-50',
    amber: 'border-amber-200 bg-amber-50',
    slate: 'border-slate-200 bg-white',
  };
  const valueTone: Record<string, string> = {
    rose: 'text-rose-700',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    slate: 'text-slate-900',
  };
  return (
    <div className={`rounded-md border px-4 py-3 ${toneMap[tone]}`}>
      <p className="text-xs font-semibold text-slate-600">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueTone[tone]}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'ACTIVE') return <Badge tone="success">{STATUS_LABELS[status]}</Badge>;
  if (status === 'TRIALING') return <Badge tone="info">{STATUS_LABELS[status]}</Badge>;
  if (status === 'PAST_DUE') return <Badge tone="warning">{STATUS_LABELS[status]}</Badge>;
  if (status === 'CANCELED') return <Badge tone="gray">{STATUS_LABELS[status]}</Badge>;
  if (status === 'INCOMPLETE') return <Badge tone="gray">支払い未完了</Badge>;
  if (status === 'INCOMPLETE_EXPIRED') return <Badge tone="gray">支払い未完了（期限切れ）</Badge>;
  return <Badge tone="gray">{STATUS_LABELS[status] ?? status}</Badge>;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
