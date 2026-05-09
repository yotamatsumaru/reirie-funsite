import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatJpy } from '@/lib/pricing';

export const metadata: Metadata = { title: '商品管理' };
export const dynamic = 'force-dynamic';

export default async function AdminProductsPage() {
  const products = await prisma.product.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 50,
    include: {
      category: { select: { name: true } },
      variants: { include: { inventory: true } },
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">商品管理</h1>
        <Link
          href="/admin/products/new"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + 新規商品
        </Link>
      </div>
      <Card>
        <CardBody className="p-0">
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
              {products.map((p) => {
                const stock = p.variants.reduce(
                  (sum, v) => sum + (v.inventory ? v.inventory.quantity - v.inventory.reserved : 0),
                  0,
                );
                return (
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
                      {stock <= 5 ? <Badge tone="warning">{stock}</Badge> : stock}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={p.isActive ? 'success' : 'gray'}>
                        {p.isActive ? '販売中' : '停止'}
                      </Badge>
                      {p.isPremiumExclusive && <Badge tone="brand" className="ml-1">PREMIUM</Badge>}
                    </td>
                  </tr>
                );
              })}
              {products.length === 0 && (
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
