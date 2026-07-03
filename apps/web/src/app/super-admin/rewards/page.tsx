/**
 * /super-admin/rewards — 特典ポイント統計・手動調整
 *
 * SUPER_ADMIN 限定。特典ポイントの発行総数・取引件数・景品カタログ/パック件数を
 * 一覧表示し、ユーザーを検索して残高を手動調整できる。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Package, Truck } from 'lucide-react';
import { requireSuperAdmin } from '@/auth';
import { prisma } from '@idol/db';
import { Card, CardBody } from '@/components/ui/Card';
import { RewardPointAdjustButton } from './reward-adjust-button';

export const metadata: Metadata = { title: '特典ポイント統計 | Super Admin' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

type SearchParams = { q?: string; page?: string };

export default async function SuperAdminRewardsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  const [totalRewardPoints, txCount, catalogCount, packCount, redemptionCount] =
    await Promise.all([
      prisma.user.aggregate({ _sum: { rewardPoints: true } }),
      prisma.rewardPointTransaction.count(),
      prisma.rewardCatalogItem.count(),
      prisma.rewardPointPack.count(),
      prisma.rewardRedemption.count(),
    ]);

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
        rewardPoints: true,
      },
      orderBy: { rewardPoints: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.user.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">特典ポイント統計</h1>
        <p className="mt-1 text-sm text-slate-600">
          課金・サブスク特典で貯まる「特典ポイント」の発行状況を確認し、ユーザーの残高を手動調整できます。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">発行済み特典ポイント総数</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {(totalRewardPoints._sum.rewardPoints ?? 0).toLocaleString()}
              <span className="ml-1 text-sm font-normal text-slate-500">pt</span>
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">特典ポイント取引件数</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {txCount.toLocaleString()}
              <span className="ml-1 text-sm font-normal text-slate-500">件</span>
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">景品交換件数</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {redemptionCount.toLocaleString()}
              <span className="ml-1 text-sm font-normal text-slate-500">件</span>
            </p>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/super-admin/rewards/packs"
          className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50"
        >
          <Package className="h-5 w-5 text-brand-500" aria-hidden />
          特典ポイントパック管理 ({packCount} 件)
        </Link>
        <Link
          href="/admin/rewards/catalog"
          className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50"
        >
          <Truck className="h-5 w-5 text-brand-500" aria-hidden />
          景品カタログ・発送管理 ({catalogCount} 件)
        </Link>
      </div>

      <Card>
        <CardBody className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">ユーザー別残高・手動調整</h2>
            <p className="mt-1 text-xs text-slate-500">
              検索してユーザーの特典ポイント残高を手動で加減算できます。
            </p>
          </div>
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

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3">ユーザー</th>
                  <th className="px-4 py-3">会員番号</th>
                  <th className="px-4 py-3 text-right">特典ポイント</th>
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
                        <p className="font-medium text-slate-800">
                          {u.displayName || '(名称未設定)'}
                        </p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">
                        {u.memberNumber ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-900">
                        {u.rewardPoints.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <RewardPointAdjustButton userId={u.id} currentBalance={u.rewardPoints} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-slate-600">
            <p>
              {total.toLocaleString()} 件中 {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–
              {Math.min(page * PAGE_SIZE, total)} 件
            </p>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={`/super-admin/rewards?${new URLSearchParams({ q, page: String(page - 1) })}`}
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
                  href={`/super-admin/rewards?${new URLSearchParams({ q, page: String(page + 1) })}`}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
                >
                  次へ
                </Link>
              )}
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
