/**
 * GET /api/products/[slug]
 *  - 商品詳細 (variants/images/inventory込み)
 *  - 会員限定/プレミアム限定はプラン未満の場合 403
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { canAccess } from '@idol/shared';
import { resolveApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';
import { effectiveUnitPrice } from '@/lib/pricing';

export const runtime = 'nodejs';

export const GET = handle(
  async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
    const { slug } = await ctx.params;
    const session = await resolveApiSession(req);
    const plan = session?.user?.plan ?? 'FREE';

    const product = await prisma.product.findUnique({
      where: { slug },
      include: {
        category: { select: { id: true, slug: true, name: true } },
        images: { orderBy: { sortOrder: 'asc' } },
        variants: {
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
          include: { inventory: true },
        },
      },
    });

    if (!product || !product.isActive) throw errors.notFound('商品が見つかりません');

    // アクセス制御
    if (product.isPremiumExclusive && !canAccess(plan, 'PREMIUM')) {
      throw errors.planRequired('プレミアム');
    }
    if (product.isMembersOnly && !canAccess(plan, 'MEMBERS')) {
      throw errors.planRequired('スタンダード');
    }

    const variants = product.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      name: v.name,
      optionColor: v.optionColor,
      optionSize: v.optionSize,
      priceDelta: v.priceDelta,
      effectivePrice: effectiveUnitPrice(
        {
          basePrice: product.basePrice,
          memberPrice: product.memberPrice,
          premiumPrice: product.premiumPrice,
        },
        v.priceDelta,
        plan,
      ),
      inStock: v.inventory
        ? v.inventory.quantity - v.inventory.reserved - v.inventory.safetyStock > 0
        : false,
      stockQuantity: v.inventory
        ? Math.max(0, v.inventory.quantity - v.inventory.reserved - v.inventory.safetyStock)
        : 0,
    }));

    return NextResponse.json({
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description,
      basePrice: product.basePrice,
      memberPrice: product.memberPrice,
      premiumPrice: product.premiumPrice,
      isMembersOnly: product.isMembersOnly,
      isPremiumExclusive: product.isPremiumExclusive,
      category: product.category,
      images: product.images.map((i) => ({ id: i.id, url: i.url, alt: i.alt })),
      variants,
    });
  },
);
