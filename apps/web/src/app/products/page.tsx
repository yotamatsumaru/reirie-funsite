import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { canAccess } from '@idol/shared';
import type { Prisma } from '@idol/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { effectiveUnitPrice, formatJpy } from '@/lib/pricing';

export const metadata: Metadata = { title: 'グッズ' };
export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const session = await auth();
  const plan = session?.user?.plan ?? 'FREE';

  const accessOr: Prisma.ProductWhereInput[] = [
    { isMembersOnly: false, isPremiumExclusive: false },
  ];
  if (canAccess(plan, 'MEMBERS')) accessOr.push({ isMembersOnly: true, isPremiumExclusive: false });
  if (canAccess(plan, 'PREMIUM')) accessOr.push({ isPremiumExclusive: true });

  const products = await prisma.product.findMany({
    where: { isActive: true, OR: accessOr },
    orderBy: { createdAt: 'desc' },
    take: 24,
    include: {
      images: { orderBy: { sortOrder: 'asc' }, take: 1 },
      variants: { where: { isActive: true }, take: 1, include: { inventory: true } },
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold text-slate-800">グッズ</h1>
      {products.length === 0 ? (
        <p className="text-sm text-slate-500">公開されている商品はありません</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => {
            const v = p.variants[0];
            const price = v
              ? effectiveUnitPrice(
                  { basePrice: p.basePrice, memberPrice: p.memberPrice, premiumPrice: p.premiumPrice },
                  v.priceDelta,
                  plan,
                )
              : p.basePrice;
            const inStock = v?.inventory ? v.inventory.quantity - v.inventory.reserved > 0 : false;
            return (
              <Link key={p.id} href={`/products/${p.slug}`}>
                <Card className="h-full transition-shadow hover:shadow-md">
                  <div className="aspect-square w-full overflow-hidden rounded-t-lg bg-slate-100">
                    {p.images[0]?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.images[0].url} alt={p.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-slate-400">
                        No Image
                      </div>
                    )}
                  </div>
                  <CardBody>
                    <div className="mb-2 flex flex-wrap gap-1">
                      {p.isPremiumExclusive && <Badge tone="brand">PREMIUM限定</Badge>}
                      {p.isMembersOnly && !p.isPremiumExclusive && (
                        <Badge tone="info">会員限定</Badge>
                      )}
                      {!inStock && <Badge tone="gray">在庫切れ</Badge>}
                    </div>
                    <h2 className="mb-1 line-clamp-2 text-sm font-semibold text-slate-800">
                      {p.name}
                    </h2>
                    <p className="text-base font-bold text-brand-600">{formatJpy(price)}</p>
                  </CardBody>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
