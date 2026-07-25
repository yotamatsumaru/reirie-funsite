/**
 * /super-admin/points/users — 全ユーザーの Pui 状況監視
 *
 * SUPER_ADMIN 限定。各ユーザーの保有 Pui ・会員番号・台帳合計・整合性を一覧表示し、
 * 検索・ページングできる。台帳 (PuiTransaction) との差分 (diff) も併記し、
 * 不整合があれば視覚的に警告する。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSuperAdminView } from '@/auth';
import { prisma } from '@idol/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PointAdjustButton } from './adjust-button';

export const metadata: Metadata = { title: 'Pui 状況 (全ユーザー) | Super Admin' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

type SearchParams = { q?: string; page?: string };

export default async function PointsUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireSuperAdminView();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: 'insensitive' as const } },
          { memberNumber: { contains: q, mode: 'insensitive' as const } },
          { displayName: { contains: q, mode: 'insensitive' as const } },
        ],
      }
    : {};

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        displayName: true,
        memberNumber: true,
        pui: true,
        role: true,
      },
      orderBy: { pui: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.user.count({ where }),
  ]);

  // 台帳合計を一括取得して整合性チェック
  const userIds = users.map((u) => u.id);
  const sums = userIds.length
    ? await prisma.puiTransaction.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds } },
        _sum: { amount: true },
      })
    : [];
  const ledgerByUser = new Map(sums.map((s) => [s.userId, s._sum.amount ?? 0]));

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Pui 状況 (全ユーザー)</h1>
          <p className="mt-1 text-sm text-slate-600">
            保有 Pui と台帳合計を突き合わせて監視します。差分があるユーザーは警告表示されます。
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/super-admin/points" className="text-slate-500 hover:underline">
            Pui 設定
          </Link>
          <Link href="/super-admin/points/transactions" className="text-brand-600 hover:underline">
            取引ログ →
          </Link>
        </div>
      </div>

      {/* 検索 */}
      <form method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="メール / 会員番号 / 表示名で検索"
          className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          検索
        </button>
      </form>

      <Card>
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3">ユーザー</th>
                  <th className="px-4 py-3">会員番号</th>
                  <th className="px-4 py-3 text-right">保有 Pui</th>
                  <th className="px-4 py-3 text-right">台帳合計</th>
                  <th className="px-4 py-3 text-center">整合性</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                      該当するユーザーがいません。
                    </td>
                  </tr>
                ) : (
                  users.map((u) => {
                    const ledger = ledgerByUser.get(u.id) ?? 0;
                    const diff = u.pui - ledger;
                    const consistent = diff === 0 && u.pui >= 0;
                    return (
                      <tr key={u.id} className={consistent ? '' : 'bg-rose-50/60'}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">
                            {u.displayName || '(名称未設定)'}
                          </p>
                          <p className="text-xs text-slate-500">{u.email}</p>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">
                          {u.memberNumber ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-900">
                          {u.pui.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                          {ledger.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {consistent ? (
                            <Badge tone="success">一致</Badge>
                          ) : (
                            <Badge tone="danger">差分 {diff > 0 ? '+' : ''}{diff}</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <PointAdjustButton
                            userId={u.id}
                            label={u.displayName || u.email || u.id}
                            currentBalance={u.pui}
                            inconsistent={!consistent}
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* ページング */}
      <div className="flex items-center justify-between text-sm text-slate-600">
        <p>
          {total.toLocaleString()} 件中 {(page - 1) * PAGE_SIZE + 1}–
          {Math.min(page * PAGE_SIZE, total)} 件
        </p>
        <div className="flex gap-2">
          {page > 1 && (
            <Link
              href={`/super-admin/points/users?${new URLSearchParams({ q, page: String(page - 1) })}`}
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
              href={`/super-admin/points/users?${new URLSearchParams({ q, page: String(page + 1) })}`}
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
