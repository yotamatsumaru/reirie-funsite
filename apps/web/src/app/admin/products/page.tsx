import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatJpy } from '@/lib/pricing';
import { requireCapabilityPage } from '@/auth';

export const metadata: Metadata = { title: '商品管理' };
export const dynamic = 'force-dynamic';

export default async function AdminProductsPage() {
  await requireCapabilityPage('MERCH');
  const products = await prisma.product.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 50,
    include: {
      category: { select: { name: true } },
      variants: { include: { inventory: true } },
    },
  });

  const productsWithStock = products.map((p) => ({
    ...p,
    stock: p.variants.reduce(
      (sum, v) => sum + (v.inventory ? v.inventory.quantity - v.inventory.reserved : 0),
      0,
    ),
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">商品管理</h1>
        <Link
          href="/admin/products/new"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + 新規商品
        </Link>
      </div>

      {/* モバイル: カードリスト */}
      <div className="space-y-3 md:hidden">
        {productsWithStock.length === 0 ? (
          <Card>
            <CardBody className="text-center text-sm text-slate-500">商品はありません</CardBody>
          </Card>
        ) : (
          productsWithStock.map((p) => (
            <Card key={p.id}>
              <CardBody className="space-y-2">
                <Link
                  href={`/admin/products/${p.id}`}
                  className="block font-semibold text-brand-600 hover:underline"
                >
                  {p.name}
                </Link>
                <p className="text-xs text-slate-400">{p.slug}</p>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-slate-500">{p.category?.name ?? '-'}</span>
                  <span className="font-semibold text-slate-800">{formatJpy(p.basePrice)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <Badge tone={p.isActive ? 'success' : 'gray'}>
                    {p.isActive ? '販売中' : '停止'}
                  </Badge>
                  {p.isPremiumExclusive && <Badge tone="brand">PREMIUM</Badge>}
                  {p.stock <= 5 ? (
                    <Badge tone="warning">在庫 {p.stock}</Badge>
                  ) : (
                    <Badge tone="gray">在庫 {p.stock}</Badge>
                  )}
                </div>
              </CardBody>
            </Card>
          ))
        )}
      </div>

      {/* デスクトップ: テーブル */}
      <Card className="hidden md:block">
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">商品名</th>
                <th className="px-4 py-3">カテゴリ</th>
                <th className="px-4 py-3">価格</th>
                <th className="px-4 py-3">在庫合計</th>
                <th className="px-4 py-3">状態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {productsWithStock.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/products/${p.id}`}
                      className="text-brand-600 hover:underline"
                    >
                      {p.name}
                    </Link>
                    <p className="text-xs text-slate-400">{p.slug}</p>
                  </td>
                  <td className="px-4 py-3">{p.category?.name ?? '-'}</td>
                  <td className="px-4 py-3">{formatJpy(p.basePrice)}</td>
                  <td className="px-4 py-3">
                    {p.stock <= 5 ? <Badge tone="warning">{p.stock}</Badge> : p.stock}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={p.isActive ? 'success' : 'gray'}>
                      {p.isActive ? '販売中' : '停止'}
                    </Badge>
                    {p.isPremiumExclusive && <Badge tone="brand" className="ml-1">PREMIUM</Badge>}
                  </td>
                </tr>
              ))}
              {productsWithStock.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    商品はありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
