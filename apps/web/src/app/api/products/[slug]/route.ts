/**
 * GET /api/products/[slug]
 *  - 商品詳細 (variants/images/inventory込み)
 *  - 会員限定/プレミアム限定はプラン未満の場合 403
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { canAccess, getSaleStatus, methodsForProduct } from '@idol/shared';
import { listActiveShippingMethods } from '@/lib/shipping';
import { resolveApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';
import { effectiveUnitPrice } from '@/lib/pricing';
import { getSiteSectionVisibility } from '@/lib/app-setting';

export const runtime = 'nodejs';

export const GET = handle(
  async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
    const { productsVisible } = await getSiteSectionVisibility();
    if (!productsVisible) throw errors.notFound('商品が見つかりません');

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
        options: { orderBy: { sortOrder: 'asc' } },
        shippingMethods: { select: { shippingMethodId: true } },
      },
    });

    if (!product || !product.isActive) throw errors.notFound('商品が見つかりません');

    // 発売前 / 販売終了 でも商品ページ自体は返す (予告として見せたいため)。
    // 購入可否は saleStatus でクライアントが判断し、サーバー側のカート追加でも再検証する。
    const saleStatus = getSaleStatus(product);
    const allShipping = await listActiveShippingMethods();
    const shippingMethods = methodsForProduct(
      allShipping,
      product.shippingMethods.map((s) => s.shippingMethodId),
    );

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
      // ---- 販売期間 ----
      saleStatus,
      saleStartsAt: product.saleStartsAt,
      saleEndsAt: product.saleEndsAt,
      // ---- 商品オプション (宛名など、購入時に入力してもらう項目) ----
      options: product.options.map((o) => ({
        id: o.id,
        name: o.name,
        helpText: o.helpText,
        maxLength: o.maxLength,
        price: o.price,
        isRequired: o.isRequired,
      })),
      // ---- この商品で選べる配送方法 (未割当なら基本配送) ----
      shippingMethods: shippingMethods.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        fee: m.fee,
      })),
    });
  },
);
