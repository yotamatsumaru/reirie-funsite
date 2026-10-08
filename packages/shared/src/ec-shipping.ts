/**
 * ec-shipping — 配送方法 (送料) の解決ロジック (純粋関数)
 *
 * 【背景】
 * BASE の「送料詳細設定 App」と同じく、商品ごとに使える配送方法
 * (ネコポス / 宅急便コンパクト / 宅急便 …) を割り当て、購入者はカート内の
 * 全商品が対応している配送方法の中から 1 つを選ぶ。
 *
 *  - 商品に配送方法が 1 つも割り当てられていない → 「基本配送」(isDefault) が適用される
 *  - カート内の商品ごとの候補集合の «積集合» が選べる配送方法
 *  - 積集合が空 → 送料が最も高い商品側の候補を採用する (安全側 = 送料の取りこぼし防止)。
 *    実運用では「大きい物が入っていれば宅急便」になるのが自然なのでこの挙動で良い
 *  - 送料無料閾値 (プラン別) に達していれば送料は 0 円
 *
 * DB にもフロントにも依存しないよう、入力は最小限の plain object にしている。
 */

export interface ShippingMethodLike {
  id: string;
  name: string;
  fee: number;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}

/** カート/注文の 1 商品ぶんの「割り当て済み配送方法 id」 */
export interface ShippableLine {
  productId: string;
  /** その商品に割り当てられた配送方法 id (空なら基本配送) */
  shippingMethodIds: string[];
}

function sortMethods<T extends ShippingMethodLike>(list: T[]): T[] {
  return [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.fee - b.fee || a.name.localeCompare(b.name));
}

/**
 * 1 商品が使える配送方法を返す。
 * 割り当てが無い (または割り当て先が全部無効) なら基本配送 (isDefault) にフォールバック。
 */
export function methodsForProduct<T extends ShippingMethodLike>(
  all: T[],
  assignedIds: string[],
): T[] {
  const active = all.filter((m) => m.isActive);
  const assigned = active.filter((m) => assignedIds.includes(m.id));
  if (assigned.length > 0) return sortMethods(assigned);
  return sortMethods(active.filter((m) => m.isDefault));
}

/**
 * カート全体で選べる配送方法を返す。
 *
 *  - 全商品の候補の積集合
 *  - 積集合が空なら「候補の最低送料が一番高い商品」の候補を採用 (大きい荷物側に合わせる)
 *  - カートが空なら []
 */
export function availableMethodsForCart<T extends ShippingMethodLike>(
  all: T[],
  lines: ShippableLine[],
): T[] {
  if (lines.length === 0) return [];
  // 同じ商品が複数行 (サイズ違い等) あっても候補は同じなので productId で重複排除
  const seen = new Set<string>();
  const perProduct: T[][] = [];
  for (const line of lines) {
    if (seen.has(line.productId)) continue;
    seen.add(line.productId);
    perProduct.push(methodsForProduct(all, line.shippingMethodIds));
  }
  if (perProduct.length === 0) return [];

  let intersection = perProduct[0]!;
  for (let i = 1; i < perProduct.length; i++) {
    const ids = new Set(perProduct[i]!.map((m) => m.id));
    intersection = intersection.filter((m) => ids.has(m.id));
  }
  if (intersection.length > 0) return sortMethods(intersection);

  // 積集合が空: 最低送料が最も高い商品 (= 一番大きい荷物) の候補に合わせる
  let best: T[] = [];
  let bestMin = -1;
  for (const cands of perProduct) {
    if (cands.length === 0) continue;
    const min = Math.min(...cands.map((m) => m.fee));
    if (min > bestMin) {
      bestMin = min;
      best = cands;
    }
  }
  return sortMethods(best);
}

/**
 * 購入者が選んだ配送方法 (selectedId) を候補の中から確定する。
 * 未選択 / 候補外なら先頭 (= 一番安い・並び順先頭) を既定として返す。候補が無ければ null。
 */
export function pickShippingMethod<T extends ShippingMethodLike>(
  candidates: T[],
  selectedId: string | null | undefined,
): T | null {
  if (candidates.length === 0) return null;
  if (selectedId) {
    const hit = candidates.find((m) => m.id === selectedId);
    if (hit) return hit;
  }
  return candidates[0]!;
}

/**
 * 送料を確定する。
 *  - threshold === 0 は「常時無料」
 *  - 小計が閾値以上なら 0 円
 *  - 配送方法が無い (null) なら fallbackFee (従来の一律送料) を使う
 */
export function resolveShippingFee(
  method: { fee: number } | null,
  itemsSubtotal: number,
  freeShippingThreshold: number,
  fallbackFee: number,
): number {
  if (freeShippingThreshold === 0 || itemsSubtotal >= freeShippingThreshold) return 0;
  return method ? method.fee : fallbackFee;
}

/** ヤマト B2 クラウド「送り状種類」コードの選択肢 (管理画面のプルダウン用) */
export const B2_INVOICE_TYPES: ReadonlyArray<{ code: string; label: string }> = [
  { code: '0', label: '発払い (宅急便)' },
  { code: '7', label: 'ネコポス' },
  { code: '8', label: '宅急便コンパクト' },
  { code: '3', label: 'DM便' },
];
