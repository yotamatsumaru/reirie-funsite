/**
 * /admin/products/shipping — 配送方法・送料の設定 (BASE「送料詳細設定 App」相当)
 *
 * ネコポス / 宅急便コンパクト / 宅急便 など、商品のサイズに応じた配送方法と
 * 全国一律送料を登録する。登録した配送方法は各商品の編集画面で割り当てる。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { requireCapabilityPage } from '@/auth';
import { ShippingMethodsClient, type ShippingMethodRow } from './shipping-methods-client';

export const metadata: Metadata = { title: '配送方法・送料設定' };
export const dynamic = 'force-dynamic';

export default async function AdminShippingMethodsPage() {
  await requireCapabilityPage('MERCH');

  const rows = await prisma.shippingMethod.findMany({
    orderBy: [{ sortOrder: 'asc' }, { fee: 'asc' }],
    include: { _count: { select: { products: true } } },
  });

  const items: ShippingMethodRow[] = rows.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    fee: m.fee,
    isDefault: m.isDefault,
    isActive: m.isActive,
    sortOrder: m.sortOrder,
    b2InvoiceType: m.b2InvoiceType,
    productCount: m._count.products,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">配送方法・送料設定</h1>
          <p className="mt-1 text-xs text-slate-500">
            商品のサイズに応じて選べる配送方法（ネコポス / 宅急便コンパクト / 宅急便 など）を登録します。
            登録後、各商品の編集画面で使える配送方法を割り当ててください。
          </p>
        </div>
        <Link
          href="/admin/products"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          ← 商品一覧へ
        </Link>
      </div>
      <ShippingMethodsClient items={items} />
    </div>
  );
}
