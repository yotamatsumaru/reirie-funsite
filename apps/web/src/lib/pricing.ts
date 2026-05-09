import type { PlanTypeLiteral } from '@idol/shared';
import { TAX_RATE, SHIPPING_FEE_DEFAULT, FREE_SHIPPING_THRESHOLD } from '@idol/shared';

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

export function calculateOrderTotals(itemsSubtotal: number) {
  const taxAmount = Math.floor(itemsSubtotal * TAX_RATE);
  const shippingFee = itemsSubtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE_DEFAULT;
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
