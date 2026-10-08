import type { PlanTypeLiteral } from '@idol/shared';
import {
  TAX_RATE,
  SHIPPING_FEE_DEFAULT,
  FREE_SHIPPING_THRESHOLD,
  FREE_SHIPPING_THRESHOLD_BY_PLAN,
} from '@idol/shared';

interface PriceableProduct {
  basePrice: number;
  memberPrice: number | null;
  premiumPrice: number | null;
}

export function effectiveUnitPrice(
  product: PriceableProduct,
  variantPriceDelta: number,
  plan: PlanTypeLiteral,
): number {
  let unit = product.basePrice;
  if (plan === 'PREMIUM' && product.premiumPrice != null) {
    unit = product.premiumPrice;
  } else if (plan !== 'FREE' && product.memberPrice != null) {
    unit = product.memberPrice;
  }
  return unit + variantPriceDelta;
}

/**
 * プラン別の送料無料閾値を返す。
 * PREMIUM は閾値 0 = 常時送料無料。
 */
export function freeShippingThresholdFor(plan: PlanTypeLiteral | null | undefined): number {
  if (!plan) return FREE_SHIPPING_THRESHOLD;
  return FREE_SHIPPING_THRESHOLD_BY_PLAN[plan] ?? FREE_SHIPPING_THRESHOLD;
}

/**
 * 注文金額・税・送料の集計
 *
 * @param itemsSubtotal 商品小計
 * @param plan          ユーザーのプラン (省略時は FREE 扱い)
 *   - PREMIUM: 常時送料無料
 *   - その他 : ¥8,000 以上で送料無料
 */
export function calculateOrderTotals(
  itemsSubtotal: number,
  plan: PlanTypeLiteral | null | undefined = 'FREE',
  /**
   * 配送方法から決まった送料 (送料無料判定前の値)。
   * 省略時は従来の一律送料 (SHIPPING_FEE_DEFAULT) を使う。
   * 商品ごとに配送方法 (ネコポス / 宅急便コンパクト / 宅急便) が違うため、
   * 呼び出し側 (lib/shipping.ts) で解決した送料を渡せるようにした。
   */
  baseShippingFee: number = SHIPPING_FEE_DEFAULT,
) {
  const taxAmount = Math.floor(itemsSubtotal * TAX_RATE);
  const threshold = freeShippingThresholdFor(plan);
  // threshold === 0 は「常時無料」の意味
  const shippingFee =
    threshold === 0 || itemsSubtotal >= threshold ? 0 : baseShippingFee;
  const totalAmount = itemsSubtotal + taxAmount + shippingFee;
  return { subtotal: itemsSubtotal, taxAmount, shippingFee, totalAmount };
}

export function generateOrderNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ORD-${ts}-${rand}`;
}

export function formatJpy(yen: number): string {
  return `¥${yen.toLocaleString('ja-JP')}`;
}
