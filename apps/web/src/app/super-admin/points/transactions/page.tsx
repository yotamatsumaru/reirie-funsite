/**
 * /super-admin/points/transactions — ポイント取引ログ & 異常検知
 *
 * SUPER_ADMIN 限定。
 *  - 上部: 整合性チェック (台帳合計 vs 残高) の異常一覧 + ポイント関連の監査ログ概要。
 *  - 下部: 全ユーザーのポイント取引履歴 (フィルタ: 理由 / ユーザー検索)。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSuperAdmin } from '@/auth';
import { prisma } from '@idol/db';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { findPointAnomalies } from '@/lib/points';

export const metadata: Metadata = { title: 'ポイント取引ログ | Super Admin' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const REASON_LABELS: Record<string, string> = {
  LOGIN_BONUS: 'ログインボーナス',
  LOGIN_STREAK: '連続ログイン',
  SOCIAL_SHARE: 'SNSシェア',
  ADMIN_ADJUST: '管理者調整',
  SIGNUP_BONUS: '新規登録',
  OTHER: 'その他/是正',
};

const REASONS = Object.keys(REASON_LABELS);

type SearchParams = { reason?: string; q?: string; page?: string };

export default async function PointsTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const reason = REASONS.includes(sp.reason ?? '') ? sp.reason : undefined;
  const q = (sp.q ?? '').trim();
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  // ユーザー検索 → 該当 userId へ絞り込み
  let userIdFilter: string[] | undefined;
  if (q) {
    const matched = await prisma.user.findMany({
      where: {
        OR: [
          { email: { contains: q, mode: 'insensitive' } },
          { memberNumber: { contains: q, mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
      take: 500,
    });
    userIdFilter = matched.map((m) => m.id);
    if (userIdFilter.length === 0) userIdFilter = ['00000000-0000-0000-0000-000000000000'];
  }

  const where = {
    ...(reason ? { reason: reason as never } : {}),
    ...(userIdFilter ? { userId: { in: userIdFilter } } : {}),
  };

  const [anomalies, transactions, total] = await Promise.all([
    findPointAnomalies(),
    prisma.pointTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        user: { select: { email: true, displayName: true, memberNumber: true } },
      },
    }),
    prisma.pointTransaction.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">ポイント取引ログ</h1>
          <p className="mt-1 text-sm text-slate-600">
            全ユーザーのポイント増減履歴と整合性チェックを確認できます。
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/super-admin/points/users" className="text-brand-600 hover:underline">
            ← 全ユーザー状況
          </Link>
          <Link href="/super-admin/audit" className="text-slate-500 hover:underline">
            監査ログ
          </Link>
        </div>
      </div>

      {/* 異常検知 */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">整合性チェック (異常検知)</h2>
          {anomalies.length === 0 ? (
            <Badge tone="success">異常なし</Badge>
          ) : (
            <Badge tone="danger">{anomalies.length} 件の不整合</Badge>
          )}
        </CardHeader>
        <CardBody>
          {anomalies.length === 0 ? (
            <p className="text-sm text-slate-500">
              すべてのユーザーで「保有ポイント = 取引台帳の合計」が一致しています。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400">
                    <th className="px-3 py-2">ユーザー</th>
                    <th className="px-3 py-2 text-right">保有pt</th>
                    <th className="px-3 py-2 text-right">台帳合計</th>
                    <th className="px-3 py-2 text-right">差分</th>
                    <th className="px-3 py-2 text-right">取引数</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {anomalies.map((a) => (
                    <tr key={a.userId} className="bg-rose-50/40">
                      <td className="px-3 py-2">
                        <p className="text-slate-700">{a.email ?? a.userId}</p>
                        {a.memberNumber && (
                          <p className="font-mono text-xs text-slate-400">{a.memberNumber}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.storedBalance.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.ledgerSum.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums text-rose-600">
                        {a.diff > 0 ? '+' : ''}
                        {a.diff.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{a.txCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-slate-500">
                ※ 差分があるユーザーは
                <Link href="/super-admin/points/users" className="text-brand-600 hover:underline">
                  全ユーザー状況
                </Link>
                から「台帳に是正」で修正できます。
              </p>
            </div>
          )}
        </CardBody>
      </Card>

      {/* フィルタ */}
      <form method="get" className="flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="メール / 会員番号 / 表示名"
          className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <select
          name="reason"
          defaultValue={reason ?? ''}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">すべての理由</option>
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {REASON_LABELS[r]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          絞り込み
        </button>
      </form>

      {/* 取引一覧 */}
      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3">日時</th>
                  <th className="px-4 py-3">ユーザー</th>
                  <th className="px-4 py-3">理由</th>
                  <th className="px-4 py-3 text-right">増減</th>
                  <th className="px-4 py-3 text-right">取引後残高</th>
                  <th className="px-4 py-3">メモ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                      該当する取引がありません。
                    </td>
                  </tr>
                ) : (
                  transactions.map((t) => (
                    <tr key={t.id}>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {new Date(t.createdAt).toLocaleString('ja-JP')}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-700">{t.user?.email ?? t.userId}</p>
                        {t.user?.memberNumber && (
                          <p className="font-mono text-xs text-slate-400">{t.user.memberNumber}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={t.reason === 'ADMIN_ADJUST' ? 'info' : 'gray'}>
                          {REASON_LABELS[t.reason] ?? t.reason}
                        </Badge>
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-bold tabular-nums ${
                          t.amount > 0 ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {t.amount > 0 ? '+' : ''}
                        {t.amount.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                        {t.balance.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{t.note ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* ページング */}
      <div className="flex items-center justify-between text-sm text-slate-600">
        <p>
          {total.toLocaleString()} 件中 {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–
          {Math.min(page * PAGE_SIZE, total)} 件
        </p>
        <div className="flex gap-2">
          {page > 1 && (
            <Link
              href={`/super-admin/points/transactions?${new URLSearchParams({
                ...(q ? { q } : {}),
                ...(reason ? { reason } : {}),
                page: String(page - 1),
              })}`}
              className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
            >
              前へ
            </Link>
          )}
          <span className="px-2 py-1.5">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/super-admin/points/transactions?${new URLSearchParams({
                ...(q ? { q } : {}),
                ...(reason ? { reason } : {}),
                page: String(page + 1),
              })}`}
              className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
            >
              次へ
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
