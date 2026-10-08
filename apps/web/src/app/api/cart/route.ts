/**
 * GET /api/cart
 *  - 現在のユーザーのカート (なければ作成)
 *  - 各 line item にプラン別の有効単価/在庫を付与
 *  - クエリ ?shippingMethodId= で購入者が選んだ配送方法を反映した送料を返す
 *  - shipping.candidates にカート内の全商品が対応する配送方法の一覧を返す
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import {
  buildVariantLabel,
  canAccess,
  formatOptionValues,
  isPurchasable,
  parseOptionValues,
  sumOptionExtra,
} from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { handle } from '@/lib/errors';
import { calculateOrderTotals, effectiveUnitPrice } from '@/lib/pricing';
import { resolveShippingForCart } from '@/lib/shipping';

export const runtime = 'nodejs';

async function getOrCreateCart(userId: string) {
  const existing = await prisma.cart.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return existing;
  return prisma.cart.create({ data: { userId } });
}

export const GET = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const plan = session.user.plan;
  const cart = await getOrCreateCart(session.user.id);
  const url = new URL(req.url);
  const selectedShippingId = url.searchParams.get('shippingMethodId');

  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
    orderBy: { createdAt: 'asc' },
  });

  const variantIds = items.map((i) => i.variantId);
  const variants = variantIds.length
    ? await prisma.productVariant.findMany({
        where: { id: { in: variantIds } },
        include: {
          product: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } } },
          inventory: true,
        },
      })
    : [];
  const variantMap = new Map(variants.map((v) => [v.id, v]));

  const lineItems: Array<{
    id: string;
    variantId: string;
    productId: string;
    productSlug: string;
    productName: string;
    variantName: string;
    /** サイズ・カラーを含む表示用ラベル (例: 「ホワイト / L」)。
     *  variantName だけだとサイズが見えず、購入者が自分の選んだ
     *  サイズを確認できなかったため追加。 */
    variantLabel: string;
    optionSize: string | null;
    optionColor: string | null;
    /** 商品オプション (宛名など) の入力値 */
    optionValues: { optionId: string; name: string; value: string; price: number }[];
    /** 表示用: 「宛名: れいり / 言葉: ありがとう」 */
    optionLabel: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    thumbnailUrl: string | null;
    inStock: boolean;
    available: number;
    blocked: false | { reason: string };
  }> = [];
  let subtotal = 0;
  const purchasableProductIds: string[] = [];

  for (const item of items) {
    const v = variantMap.get(item.variantId);
    if (!v) continue;

    let blocked: false | { reason: string } = false;
    if (!v.isActive || !v.product.isActive) blocked = { reason: 'inactive' };
    // 発売前 / 販売終了 の商品は購入できない (カートに残っていた場合)
    if (!blocked && !isPurchasable(v.product)) blocked = { reason: 'not_on_sale' };
    if (v.product.isPremiumExclusive && !canAccess(plan, 'PREMIUM')) {
      blocked = { reason: 'plan_required' };
    }
    if (v.product.isMembersOnly && !canAccess(plan, 'MEMBERS')) {
      blocked = { reason: 'plan_required' };
    }

    const optionValues = parseOptionValues(item.optionValues);
    const unit =
      effectiveUnitPrice(
        {
          basePrice: v.product.basePrice,
          memberPrice: v.product.memberPrice,
          premiumPrice: v.product.premiumPrice,
        },
        v.priceDelta,
        plan,
      ) + sumOptionExtra(optionValues);
    const lineSubtotal = unit * item.quantity;
    if (!blocked) {
      subtotal += lineSubtotal;
      purchasableProductIds.push(v.productId);
    }

    const available = v.inventory
      ? Math.max(0, v.inventory.quantity - v.inventory.reserved - v.inventory.safetyStock)
      : 0;

    lineItems.push({
      id: item.id,
      variantId: v.id,
      productId: v.productId,
      productSlug: v.product.slug,
      productName: v.product.name,
      variantName: v.name,
      variantLabel: buildVariantLabel(v),
      optionSize: v.optionSize,
      optionColor: v.optionColor,
      optionValues,
      optionLabel: formatOptionValues(optionValues),
      quantity: item.quantity,
      unitPrice: unit,
      subtotal: lineSubtotal,
      thumbnailUrl: v.product.images[0]?.url ?? null,
      inStock: available >= item.quantity,
      available,
      blocked,
    });
  }

  // 配送方法: カート内の全商品が対応するものだけ候補にし、選択 (or 最安) で送料を決める
  const shipping = await resolveShippingForCart(
    purchasableProductIds,
    subtotal,
    plan,
    selectedShippingId,
  );
  const totals = calculateOrderTotals(subtotal, plan, shipping.selected?.fee);

  return NextResponse.json({
    cartId: cart.id,
    items: lineItems,
    plan,
    ...totals,
    shipping: {
      candidates: shipping.candidates.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        fee: m.fee,
      })),
      selectedId: shipping.selected?.id ?? null,
      freeShippingThreshold: shipping.freeShippingThreshold,
    },
  });
});
