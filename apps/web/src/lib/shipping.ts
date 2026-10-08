/**
 * 配送方法 (送料) の DB 読み込み + カート向け解決。
 *
 * 純粋ロジックは @idol/shared の ec-shipping にあり、ここでは
 *  - 配送方法マスタの取得
 *  - カート/注文の明細から「選べる配送方法」と「確定送料」を出す
 * という DB 依存部分だけを担う。
 */
import { prisma } from '@idol/db';
import {
  SHIPPING_FEE_DEFAULT,
  availableMethodsForCart,
  pickShippingMethod,
  resolveShippingFee,
  type PlanTypeLiteral,
  type ShippingMethodLike,
} from '@idol/shared';
import { freeShippingThresholdFor } from './pricing';

export interface ShippingMethodDto extends ShippingMethodLike {
  description: string | null;
  b2InvoiceType: string | null;
}

/** 有効な配送方法をすべて返す (並び順) */
export async function listActiveShippingMethods(): Promise<ShippingMethodDto[]> {
  const rows = await prisma.shippingMethod.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { fee: 'asc' }],
  });
  return rows.map(toDto);
}

export function toDto(m: {
  id: string;
  name: string;
  description: string | null;
  fee: number;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  b2InvoiceType: string | null;
}): ShippingMethodDto {
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    fee: m.fee,
    isDefault: m.isDefault,
    isActive: m.isActive,
    sortOrder: m.sortOrder,
    b2InvoiceType: m.b2InvoiceType,
  };
}

/**
 * 商品 id 群 → それぞれに割り当てられた配送方法 id の Map。
 * 割り当てなしの商品は Map に無い (呼び出し側で [] 扱い)。
 */
export async function loadProductShippingAssignments(
  productIds: string[],
): Promise<Map<string, string[]>> {
  if (productIds.length === 0) return new Map();
  const rows = await prisma.productShippingMethod.findMany({
    where: { productId: { in: productIds } },
    select: { productId: true, shippingMethodId: true },
  });
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.productId) ?? [];
    list.push(r.shippingMethodId);
    map.set(r.productId, list);
  }
  return map;
}

export interface ResolvedShipping {
  /** 購入者が選べる配送方法 (カート内の全商品が対応するもの) */
  candidates: ShippingMethodDto[];
  /** 確定した配送方法 (候補が無い場合 null → 従来の一律送料) */
  selected: ShippingMethodDto | null;
  /** 確定送料 (送料無料閾値を考慮済み) */
  fee: number;
  /** 送料無料閾値 (0 = 常時無料) */
  freeShippingThreshold: number;
}

/**
 * カート/注文の明細 (productId の配列) から配送方法と送料を確定する。
 *
 * @param productIds   購入対象の商品 id (重複可)
 * @param itemsSubtotal 商品小計 (送料無料判定に使う)
 * @param plan          購入者のプラン (送料無料閾値はプラン別)
 * @param selectedId    購入者が選んだ配送方法 id (未選択なら最安を採用)
 */
export async function resolveShippingForCart(
  productIds: string[],
  itemsSubtotal: number,
  plan: PlanTypeLiteral | null | undefined,
  selectedId?: string | null,
): Promise<ResolvedShipping> {
  const uniqueIds = Array.from(new Set(productIds));
  const [all, assignments] = await Promise.all([
    listActiveShippingMethods(),
    loadProductShippingAssignments(uniqueIds),
  ]);
  const lines = uniqueIds.map((pid) => ({
    productId: pid,
    shippingMethodIds: assignments.get(pid) ?? [],
  }));
  const candidates = availableMethodsForCart(all, lines);
  const selected = pickShippingMethod(candidates, selectedId);
  const threshold = freeShippingThresholdFor(plan);
  const fee = resolveShippingFee(selected, itemsSubtotal, threshold, SHIPPING_FEE_DEFAULT);
  return { candidates, selected, fee, freeShippingThreshold: threshold };
}
