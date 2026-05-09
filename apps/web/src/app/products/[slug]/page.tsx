import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { canAccess } from '@idol/shared';
import { effectiveUnitPrice, formatJpy } from '@/lib/pricing';
import { Badge } from '@/components/ui/Badge';
import { AddToCartForm } from '@/components/product/AddToCartForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const p = await prisma.product.findUnique({ where: { slug }, select: { name: true } });
  return { title: p?.name ?? '商品' };
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await auth();
  const plan = session?.user?.plan ?? 'FREE';

  const product = await prisma.product.findUnique({
    where: { slug },
    include: {
      category: true,
      images: { orderBy: { sortOrder: 'asc' } },
      variants: {
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        include: { inventory: true },
      },
    },
  });
  if (!product || !product.isActive) notFound();

  const blocked =
    (product.isPremiumExclusive && !canAccess(plan, 'PREMIUM')) ||
    (product.isMembersOnly && !canAccess(plan, 'MEMBERS'));

  const variants = product.variants.map((v) => ({
    id: v.id,
    name: v.name,
    optionColor: v.optionColor,
    optionSize: v.optionSize,
    effectivePrice: effectiveUnitPrice(
      { basePrice: product.basePrice, memberPrice: product.memberPrice, premiumPrice: product.premiumPrice },
      v.priceDelta,
      plan,
    ),
    stockQuantity: v.inventory
      ? Math.max(0, v.inventory.quantity - v.inventory.reserved - v.inventory.safetyStock)
      : 0,
  }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <div className="aspect-square w-full overflow-hidden rounded-lg bg-slate-100">
            {product.images[0]?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.images[0].url}
                alt={product.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-slate-400">
                No Image
              </div>
            )}
          </div>
          {product.images.length > 1 && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {product.images.slice(1).map((img) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={img.id}
                  src={img.url}
                  alt={img.alt ?? ''}
                  className="aspect-square w-full rounded-md object-cover"
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 flex flex-wrap gap-1">
            {product.category && <Badge tone="gray">{product.category.name}</Badge>}
            {product.isPremiumExclusive && <Badge tone="brand">PREMIUM限定</Badge>}
            {product.isMembersOnly && !product.isPremiumExclusive && (
              <Badge tone="info">会員限定</Badge>
            )}
          </div>
          <h1 className="text-2xl font-bold text-slate-800">{product.name}</h1>
          {product.description && (
            <p className="mt-3 whitespace-pre-line text-sm text-slate-600">{product.description}</p>
          )}

          <div className="mt-6 border-t border-slate-200 pt-4">
            {blocked ? (
              <div className="rounded-md bg-brand-50 p-4 text-sm text-brand-700">
                この商品は
                {product.isPremiumExclusive ? 'プレミアム' : 'スタンダード'}
                会員限定です。プランをアップグレードしてください。
              </div>
            ) : (
              <AddToCartForm variants={variants} loggedIn={Boolean(session?.user)} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
