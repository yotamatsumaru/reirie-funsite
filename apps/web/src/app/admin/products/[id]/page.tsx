/**
 * /admin/products/[id] — 商品の編集 + バリエーション（在庫）管理
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@idol/db';
import { requireCapabilityPage } from '@/auth';
import { ProductForm } from '../product-form';
import { VariantManager, type VariantItem } from '../variant-manager';
import { ImageManager, type ProductImageItem } from '../image-manager';

export const metadata: Metadata = { title: '商品編集' };
export const dynamic = 'force-dynamic';

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCapabilityPage('MERCH');
  const { id } = await params;

  const [product, categories] = await Promise.all([
    prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        images: { orderBy: { sortOrder: 'asc' } },
        variants: { orderBy: { createdAt: 'asc' }, include: { inventory: true } },
      },
    }),
    prisma.productCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    }),
  ]);

  if (!product) notFound();

  const productImages: ProductImageItem[] = product.images.map((img) => ({
    id: img.id,
    url: img.url,
    alt: img.alt,
    sortOrder: img.sortOrder,
  }));

  const variants: VariantItem[] = product.variants.map((v) => ({
    id: v.id,
    sku: v.sku,
    name: v.name,
    optionColor: v.optionColor,
    optionSize: v.optionSize,
    priceDelta: v.priceDelta,
    isActive: v.isActive,
    quantity: v.inventory?.quantity ?? 0,
    reserved: v.inventory?.reserved ?? 0,
    safetyStock: v.inventory?.safetyStock ?? 0,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">{product.name}</h1>
          <p className="text-xs text-slate-400">{product.slug}</p>
        </div>
        <Link
          href="/admin/products"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          ← 商品一覧へ
        </Link>
      </div>

      <ProductForm
        mode="edit"
        productId={product.id}
        categories={categories}
        initial={{
          slug: product.slug,
          name: product.name,
          description: product.description ?? '',
          basePrice: product.basePrice,
          memberPrice: product.memberPrice != null ? String(product.memberPrice) : '',
          premiumPrice: product.premiumPrice != null ? String(product.premiumPrice) : '',
          categoryId: product.categoryId ?? '',
          isActive: product.isActive,
          isMembersOnly: product.isMembersOnly,
          isPremiumExclusive: product.isPremiumExclusive,
        }}
      />

      <ImageManager productId={product.id} images={productImages} />

      <VariantManager productId={product.id} variants={variants} />
    </div>
  );
}
