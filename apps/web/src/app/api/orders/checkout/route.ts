/**
 * POST /api/orders/checkout
 *  - 現在のカートから Order を PENDING で確定
 *  - 在庫を予約 (reserved += quantity)
 *  - Stripe Checkout Session (mode=payment) を作成して URL を返す
 *  - 決済確定は Stripe Webhook (checkout.session.completed) 側で実施
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { CheckoutSchema, canAccess } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';
import { calculateOrderTotals, effectiveUnitPrice, generateOrderNumber } from '@/lib/pricing';
import { getStripe } from '@/lib/stripe';
import { env } from '@/lib/env';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const userId = session.user.id;
  const plan = session.user.plan;
  const body = CheckoutSchema.parse(await req.json());

  // 1) カート読み込み
  const cart = await prisma.cart.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: { items: true },
  });
  if (!cart || cart.items.length === 0) {
    throw errors.badRequest('カートが空です');
  }

  // 2) variant + product + inventory を一括取得
  const variantIds = cart.items.map((i) => i.variantId);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    include: { product: true, inventory: true },
  });
  const vMap = new Map(variants.map((v) => [v.id, v]));

  // 3) 在庫・プランチェック + 価格スナップショット作成
  type Snapshot = {
    variantId: string;
    productId: string;
    productName: string;
    variantName: string;
    unitPrice: number;
    quantity: number;
    subtotal: number;
  };
  const snapshots: Snapshot[] = [];
  let subtotal = 0;

  for (const item of cart.items) {
    const v = vMap.get(item.variantId);
    if (!v || !v.isActive || !v.product.isActive) {
      throw errors.conflict(`商品が販売停止になっています: ${v?.product.name ?? item.variantId}`);
    }
    if (v.product.isPremiumExclusive && !canAccess(plan, 'PREMIUM')) {
      throw errors.planRequired('プレミアム');
    }
    if (v.product.isMembersOnly && !canAccess(plan, 'MEMBERS')) {
      throw errors.planRequired('スタンダード');
    }
    const available = v.inventory
      ? Math.max(
          0,
          v.inventory.quantity - v.inventory.reserved - v.inventory.safetyStock,
        )
      : 0;
    if (available < item.quantity) {
      throw errors.conflict(`在庫不足: ${v.product.name} / ${v.name}`);
    }
    const unit = effectiveUnitPrice(
      {
        basePrice: v.product.basePrice,
        memberPrice: v.product.memberPrice,
        premiumPrice: v.product.premiumPrice,
      },
      v.priceDelta,
      plan,
    );
    const sub = unit * item.quantity;
    subtotal += sub;
    snapshots.push({
      variantId: v.id,
      productId: v.productId,
      productName: v.product.name,
      variantName: v.name,
      unitPrice: unit,
      quantity: item.quantity,
      subtotal: sub,
    });
  }

  const totals = calculateOrderTotals(subtotal, plan);

  // 4) ユーザー (Stripe customerId 取得 or 生成)
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw errors.notFound('ユーザーが見つかりません');

  const stripe = getStripe();
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.displayName ?? undefined,
      metadata: { userId },
    });
    customerId = customer.id;
    await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } });
  }

  // 5) Order(PENDING) 作成 + 在庫予約 (同一トランザクション)
  const orderNumber = generateOrderNumber();
  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        orderNumber,
        userId,
        status: 'PENDING',
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        shippingFee: totals.shippingFee,
        totalAmount: totals.totalAmount,
        currency: 'JPY',
        shippingName: body.shipping.name,
        shippingPhone: body.shipping.phone,
        shippingPostalCode: body.shipping.postalCode,
        shippingPrefecture: body.shipping.prefecture,
        shippingAddress1: body.shipping.addressLine1,
        shippingAddress2: body.shipping.addressLine2 ?? null,
        notes: body.notes ?? null,
        items: {
          create: snapshots.map((s) => ({
            productId: s.productId,
            variantId: s.variantId,
            productName: s.productName,
            variantName: s.variantName,
            unitPrice: s.unitPrice,
            quantity: s.quantity,
            subtotal: s.subtotal,
          })),
        },
      },
    });
    // 在庫を予約
    for (const s of snapshots) {
      await tx.inventory.update({
        where: { variantId: s.variantId },
        data: { reserved: { increment: s.quantity } },
      });
    }
    return created;
  });

  // 6) Stripe Checkout Session (mode=payment) を作成
  const checkout = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'jpy',
          unit_amount: totals.totalAmount,
          product_data: {
            name: `注文 ${orderNumber} (${snapshots.length}点)`,
            description: snapshots
              .map((s) => `${s.productName} / ${s.variantName} × ${s.quantity}`)
              .slice(0, 5)
              .join('\n'),
          },
        },
      },
    ],
    success_url: body.successUrl + (body.successUrl.includes('?') ? '&' : '?') + 'order=' + orderNumber,
    cancel_url: body.cancelUrl,
    metadata: {
      orderId: order.id,
      orderNumber,
      userId,
      kind: 'ONE_TIME_ORDER',
    },
    payment_intent_data: {
      metadata: {
        orderId: order.id,
        orderNumber,
        userId,
        kind: 'ONE_TIME_ORDER',
      },
    },
  });

  // 7) カートを空に
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });

  await logAudit({
    userId,
    action: 'order.checkout.created',
    resource: `order:${order.id}`,
    metadata: { orderNumber, totalAmount: totals.totalAmount },
  });

  void env; // env import keepalive

  return NextResponse.json({
    orderId: order.id,
    orderNumber,
    checkoutUrl: checkout.url,
    sessionId: checkout.id,
  });
});
