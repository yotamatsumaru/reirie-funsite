/**
 * /super-admin/rewards/packs — Pui パック管理
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { requireSuperAdminView } from '@/auth';

export const metadata: Metadata = { title: 'Pui パック管理' };
export const dynamic = 'force-dynamic';

export default async function RewardPointPacksPage() {
  await requireSuperAdminView();
  const packs = await prisma.rewardPointPack.findMany({
    orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }],
    include: { _count: { select: { purchases: true } } },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">Pui パック管理</h1>
          <p className="mt-1 text-sm text-slate-500">
            Stripe決済で購入できる Pui パックを管理します。
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/super-admin/rewards/packs/reconcile"
            className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100"
          >
            未付与を再照合
          </Link>
          <Link
            href="/super-admin/rewards"
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Pui 統計へ
          </Link>
          <Link
            href="/super-admin/rewards/packs/new"
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            + 新規パック
          </Link>
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {packs.length === 0 && (
          <Card>
            <CardBody className="text-center text-sm text-slate-500">パックがありません</CardBody>
          </Card>
        )}
        {packs.map((p) => (
          <Card key={p.id}>
            <CardBody className="space-y-2">
              <Link
                href={`/super-admin/rewards/packs/${p.id}`}
                className="block font-semibold text-brand-600 hover:underline"
              >
                {p.name}
              </Link>
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Badge tone={p.isActive ? 'success' : 'gray'}>
                  {p.isActive ? '販売中' : '非公開'}
                </Badge>
                <span className="text-xs text-slate-600">{p.pui.toLocaleString()} Pui</span>
                <span className="text-xs text-slate-600">
                  ¥{p.priceJpy.toLocaleString()}
                </span>
                <span className="text-xs text-slate-500">購入 {p._count.purchases} 件</span>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card className="hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">名前</th>
              <th className="px-4 py-2 text-right">付与 Pui</th>
              <th className="px-4 py-2 text-right">価格 (JPY)</th>
              <th className="px-4 py-2 text-right">購入数</th>
              <th className="px-4 py-2">状態</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {packs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  パックがありません
                </td>
              </tr>
            )}
            {packs.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-slate-800">{p.name}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {p.pui.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  ¥{p.priceJpy.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{p._count.purchases}</td>
                <td className="px-4 py-2">
                  <Badge tone={p.isActive ? 'success' : 'gray'}>
                    {p.isActive ? '販売中' : '非公開'}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    href={`/super-admin/rewards/packs/${p.id}`}
                    className="text-brand-600 hover:underline"
                  >
                    編集
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
