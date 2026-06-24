/**
 * /admin/products/new — 新規商品（グッズ）登録
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { requireCapabilityPage } from '@/auth';
import { ProductForm } from '../product-form';

export const metadata: Metadata = { title: '新規商品登録' };
export const dynamic = 'force-dynamic';

export default async function NewProductPage() {
  await requireCapabilityPage('MERCH');

  const categories = await prisma.productCategory.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">新規商品登録</h1>
        <Link
          href="/admin/products"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          ← 商品一覧へ
        </Link>
      </div>
      <ProductForm mode="create" categories={categories} />
    </div>
  );
}
