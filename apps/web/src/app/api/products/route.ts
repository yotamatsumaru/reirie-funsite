/**
 * GET /api/products
 *  - 公開商品一覧 (会員限定/プレミアム限定はプラン別に表示制御)
 *  - クエリ: ?category=&q=&page=&limit=
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { ListProductsQuerySchema, canAccess } from '@idol/shared';
import { auth } from '@/auth';
import { handle } from '@/lib/errors';
import { effectiveUnitPrice } from '@/lib/pricing';
import type { Prisma } from '@idol/db';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const query = ListProductsQuerySchema.parse({
    category: url.searchParams.get('category') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: url.searchParams.get('page') ?? 1,
    limit: url.searchParams.get('limit') ?? 20,
  });

  const session = await auth();
  const plan = session?.user?.plan ?? 'FREE';

  // プラン別の閲覧可否
  const accessOr: Prisma.ProductWhereInput[] = [
    { isMembersOnly: false, isPremiumExclusive: false },
  ];
  if (canAccess(plan, 'MEMBERS')) {
    accessOr.push({ isMembersOnly: true, isPremiumExclusive: false });
  }
  if (canAccess(plan, 'PREMIUM')) {
    accessOr.push({ isPremiumExclusive: true });
  }

  const where: Prisma.ProductWhereInput = {
    isActive: true,
    OR: accessOr,
    ...(query.category ? { category: { slug: query.category } } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { description: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        category: { select: { id: true, slug: true, name: true } },
        images: { orderBy: { sortOrder: 'asc' }, take: 1 },
        variants: {
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
          include: { inventory: true },
        },
      },
    }),
    prisma.product.count({ where }),
  ]);

  const items = products.map((p) => {
    const variant = p.variants[0];
    const unit = variant
      ? effectiveUnitPrice(
          { basePrice: p.basePrice, memberPrice: p.memberPrice, premiumPrice: p.premiumPrice },
          variant.priceDelta,
          plan,
        )
      : p.basePrice;
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      basePrice: p.basePrice,
      effectivePrice: unit,
      isMembersOnly: p.isMembersOnly,
      isPremiumExclusive: p.isPremiumExclusive,
      category: p.category,
      thumbnailUrl: p.images[0]?.url ?? null,
      inStock: variant?.inventory
        ? variant.inventory.quantity - variant.inventory.reserved > 0
        : false,
    };
  });

  return NextResponse.json({
    items,
    page: query.page,
    limit: query.limit,
    total,
    hasMore: query.page * query.limit < total,
  });
});
