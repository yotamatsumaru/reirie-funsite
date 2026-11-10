/**
 * /super-admin/mero — Mero (Pui の上位ポイント) の付与・残高確認
 *
 * スーパー管理者 / STAFF が閲覧でき、付与・調整はスーパー管理者のみ (SuperAdminWriteGate)。
 * Mero が非公開の間も使える (公開前に運用テストするため)。
 *
 * 上段: 公開状態・発行総量・直近の取引
 * 下段: ユーザー検索 + 付与 / 調整
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { MERO_REASON_LABELS, formatJstDateTime, type MeroReasonLiteral } from '@idol/shared';
import { requireSuperAdminView } from '@/auth';
import { getSiteSectionVisibility } from '@/lib/app-setting';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { SuperAdminWriteGate } from '@/components/admin/SuperAdminReadOnly';
import { MeroAdjustButton } from './mero-adjust-button';

export const metadata: Metadata = { title: 'Mero | Super Admin' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

export default async function SuperAdminMeroPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
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

  const [{ meroVisible }, users, total, totals, holders, recent] = await Promise.all([
    getSiteSectionVisibility(),
    prisma.user.findMany({
      where,
      select: { id: true, email: true, displayName: true, memberNumber: true, mero: true },
      // 残高の多い順 → 同じなら新しい会員順
      orderBy: [{ mero: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.user.count({ where }),
    prisma.user.aggregate({ _sum: { mero: true } }),
    prisma.user.count({ where: { mero: { gt: 0 } } }),
    prisma.meroTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        amount: true,
        balance: true,
        reason: true,
        note: true,
        createdAt: true,
        user: { select: { email: true, displayName: true } },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) =>
    `/super-admin/mero?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Mero（Pui の上位ポイント）</h1>
        <p className="mt-1 text-sm text-slate-600">
          ライブ特典・オンライン物販特典で付与する上位ポイントです。Pui とは残高も履歴も別に管理しています。
        </p>
      </div>

      {/* 公開状態 */}
      <div
        className={`rounded-lg border px-4 py-3 text-sm ${
          meroVisible
            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
            : 'border-amber-300 bg-amber-50 text-amber-900'
        }`}
      >
        {meroVisible ? (
          <p className="font-semibold">公開中：会員はマイページで Mero の残高・履歴を確認できます。</p>
        ) : (
          <>
            <p className="font-semibold">非公開（準備中）：一般の会員には Mero は一切表示されません。</p>
            <p className="mt-1 text-xs">
              この間もここから付与・調整でき、管理者は会員ページ（
              <Link href="/me/mero" className="underline">
                /me/mero
              </Link>
              ）をプレビューできます。公開は
              <Link href="/super-admin/settings" className="mx-0.5 underline">
                公開設定
              </Link>
              の「Mero」から切り替えます。
            </p>
          </>
        )}
      </div>

      {/* KPI */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardBody>
            <p className="text-xs text-slate-500">発行済み Mero（全会員の残高合計）</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
              {(totals._sum.mero ?? 0).toLocaleString()}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs text-slate-500">Mero を持っている会員</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
              {holders.toLocaleString()} 人
            </p>
          </CardBody>
        </Card>
      </div>

      {/* 直近の取引 */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-800">直近の取引（10 件）</h2>
        </CardHeader>
        <CardBody className="p-0">
          {recent.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">まだ取引はありません。</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {recent.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-slate-800">
                      {t.user.displayName || t.user.email}
                      <span className="ml-2 text-xs text-slate-500">
                        {MERO_REASON_LABELS[t.reason as MeroReasonLiteral] ?? t.reason}
                        {t.note ? `・${t.note}` : ''}
                      </span>
                    </p>
                    <p className="text-[11px] text-slate-400">{formatJstDateTime(t.createdAt)}</p>
                  </div>
                  <p
                    className={`shrink-0 font-bold tabular-nums ${
                      t.amount > 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {t.amount > 0 ? '+' : ''}
                    {t.amount.toLocaleString()}
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      残高 {t.balance.toLocaleString()}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* ユーザー検索 + 付与 */}
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
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3">ユーザー</th>
                  <th className="px-4 py-3">会員番号</th>
                  <th className="px-4 py-3 text-right">保有 Mero</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                      該当するユーザーがいません。
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{u.displayName || '(名称未設定)'}</p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{u.memberNumber ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-900">
                        {u.mero > 0 ? u.mero.toLocaleString() : <Badge tone="gray">0</Badge>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <SuperAdminWriteGate silent>
                          <MeroAdjustButton
                            userId={u.id}
                            label={u.displayName || u.email || u.id}
                            currentBalance={u.mero}
                          />
                        </SuperAdminWriteGate>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <div className="flex items-center justify-between text-sm text-slate-600">
        <p>
          {total.toLocaleString()} 件中 {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–
          {Math.min(page * PAGE_SIZE, total)} 件
        </p>
        <div className="flex gap-2">
          {page > 1 && (
            <Link href={pageHref(page - 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
              前へ
            </Link>
          )}
          <span className="px-2 py-1.5">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link href={pageHref(page + 1)} className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
              次へ
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
