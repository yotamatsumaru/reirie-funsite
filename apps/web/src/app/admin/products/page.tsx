import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { requireCapabilityPage } from '@/auth';
import { AdminProductTable, type AdminProductRow } from './bulk-sale-period';

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
      shippingMethods: { include: { shippingMethod: { select: { name: true } } } },
      _count: { select: { options: true } },
    },
  });

  const rows: AdminProductRow[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    categoryName: p.category?.name ?? null,
    basePrice: p.basePrice,
    stock: p.variants.reduce(
      (sum, v) => sum + (v.inventory ? v.inventory.quantity - v.inventory.reserved : 0),
      0,
    ),
    isActive: p.isActive,
    isPremiumExclusive: p.isPremiumExclusive,
    saleStartsAt: p.saleStartsAt?.toISOString() ?? null,
    saleEndsAt: p.saleEndsAt?.toISOString() ?? null,
    shippingMethodNames: p.shippingMethods.map((s) => s.shippingMethod.name),
    optionCount: p._count.options,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">商品管理</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/products/shipping"
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            配送方法・送料設定
          </Link>
          <Link
            href="/admin/products/new"
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            + 新規商品
          </Link>
        </div>
      </div>

      <AdminProductTable products={rows} />
    </div>
  );
}
