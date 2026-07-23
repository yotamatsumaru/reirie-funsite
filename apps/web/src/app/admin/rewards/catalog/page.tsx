/**
 * /admin/rewards/catalog — 景品カタログ管理
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { REWARD_CATALOG_ITEM_KIND_LABELS, REWARD_CATALOG_ITEM_STATUS_LABELS } from '@idol/shared';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { requireCapabilityPage } from '@/auth';

export const metadata: Metadata = { title: '景品カタログ管理' };
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, 'success' | 'gray' | 'warning'> = {
  PUBLISHED: 'success',
  DRAFT: 'gray',
  ARCHIVED: 'warning',
};

export default async function AdminRewardCatalogPage() {
  await requireCapabilityPage('MERCH');
  const items = await prisma.rewardCatalogItem.findMany({
    orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }],
    include: { _count: { select: { redemptions: true } } },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">景品カタログ管理</h1>
          <p className="mt-1 text-sm text-slate-500">
            Pui と交換できる景品 (グッズ・特典会優先枠・デジタル特典) を管理します。
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/rewards/redemptions"
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            発送管理へ
          </Link>
          <Link
            href="/admin/rewards/catalog/new"
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            + 新規景品
          </Link>
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {items.length === 0 && (
          <Card>
            <CardBody className="text-center text-sm text-slate-500">景品がありません</CardBody>
          </Card>
        )}
        {items.map((it) => (
          <Card key={it.id}>
            <CardBody className="space-y-2">
              <Link
                href={`/admin/rewards/catalog/${it.id}`}
                className="block font-semibold text-brand-600 hover:underline"
              >
                {it.name}
              </Link>
              <p className="text-xs text-slate-400">{it.slug}</p>
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Badge tone="info">{REWARD_CATALOG_ITEM_KIND_LABELS[it.kind]}</Badge>
                <Badge tone={STATUS_TONE[it.status] ?? 'gray'}>
                  {REWARD_CATALOG_ITEM_STATUS_LABELS[it.status]}
                </Badge>
                <span className="text-xs text-slate-600">{it.puiCost.toLocaleString()} Pui</span>
                <span className="text-xs text-slate-500">
                  在庫: {it.stock === null ? '無制限' : it.stock}
                </span>
                <span className="text-xs text-slate-500">交換 {it._count.redemptions} 件</span>
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
              <th className="px-4 py-2">種別</th>
              <th className="px-4 py-2 text-right">必要 Pui</th>
              <th className="px-4 py-2 text-right">在庫</th>
              <th className="px-4 py-2 text-right">交換数</th>
              <th className="px-4 py-2">状態</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  景品がありません
                </td>
              </tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-slate-800">{it.name}</td>
                <td className="px-4 py-2">{REWARD_CATALOG_ITEM_KIND_LABELS[it.kind]}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {it.puiCost.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {it.stock === null ? '無制限' : it.stock}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{it._count.redemptions}</td>
                <td className="px-4 py-2">
                  <Badge tone={STATUS_TONE[it.status] ?? 'gray'}>
                    {REWARD_CATALOG_ITEM_STATUS_LABELS[it.status]}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    href={`/admin/rewards/catalog/${it.id}`}
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
