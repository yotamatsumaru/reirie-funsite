/**
 * product-variant-label — 商品バリエーション（サイズ・カラー）の表示ロジック
 *
 * 【なぜ必要か / 実際に起きていた問題】
 * DB の ProductVariant は optionSize / optionColor を持っているのに、
 * カート・注文・領収書では variant.name しか使っていなかった。
 * その結果、
 *
 *   「ロゴTシャツ ホワイト の L」を注文 → カートには「ホワイト」だけ
 *   → 注文明細にも「ホワイト」だけが保存される
 *
 * となり、**どのサイズが注文されたのか誰にも分からない**状態だった。
 * (発送担当も、購入者本人も確認できない)
 *
 * サイズの表記ゆれを 1 箇所に集約するため、表示用の文字列はすべて
 * このモジュールを通して組み立てる。
 */

/** 表示に必要な最小限のバリエーション情報 */
export type VariantLabelInput = {
  /** バリエーション名 (例: 「ホワイト」「通常版」) */
  name?: string | null;
  optionColor?: string | null;
  optionSize?: string | null;
};

/** 値が「実質空」かどうか (null / undefined / 空白のみ) */
function isBlank(v: string | null | undefined): boolean {
  return v == null || v.trim() === '';
}

function clean(v: string | null | undefined): string | null {
  return isBlank(v) ? null : v!.trim();
}

/**
 * バリエーションの表示ラベルを組み立てる。
 *
 *   { name: 'ホワイト', optionColor: 'ホワイト', optionSize: 'L' } → 'ホワイト / L'
 *   { name: '通常版',   optionColor: null,       optionSize: null } → '通常版'
 *   { name: 'ホワイト', optionColor: 'ホワイト', optionSize: null } → 'ホワイト'
 *
 * 【重複を避ける理由】
 * 運用上、name にカラー名をそのまま入れている商品が多い
 * (実データが「name=ホワイト, optionColor=ホワイト」だった)。
 * 素直に連結すると「ホワイト / ホワイト / L」になって不格好なので、
 * 同じ値は 1 回だけ出す。
 */
export function buildVariantLabel(v: VariantLabelInput): string {
  const name = clean(v.name);
  const color = clean(v.optionColor);
  const size = clean(v.optionSize);

  const parts: string[] = [];
  const push = (value: string | null) => {
    if (!value) return;
    // 大文字小文字は区別せず重複判定する (WHITE と White を二重に出さない)
    if (parts.some((p) => p.toLowerCase() === value.toLowerCase())) return;
    parts.push(value);
  };

  push(name);
  push(color);
  push(size);

  return parts.join(' / ');
}

/**
 * 「商品名 + バリエーション」の 1 行表示。
 * 注文確認メールや Stripe の明細など、1 行で伝えたい場所で使う。
 *
 *   'REIRIE ロゴTシャツ / ホワイト / L'
 */
export function buildOrderLineLabel(
  productName: string,
  v: VariantLabelInput,
): string {
  const variant = buildVariantLabel(v);
  return variant ? `${productName} / ${variant}` : productName;
}

/**
 * サイズだけを取り出した表示用文字列 (無ければ null)。
 * 「サイズ: L」のようにラベル付きで見せたい箇所で使う。
 */
export function formatSize(v: VariantLabelInput): string | null {
  return clean(v.optionSize);
}

// ---------------------------------------------------------------
// サイズの並び順
// ---------------------------------------------------------------

/**
 * 衣類サイズの標準的な並び順。
 * DB の登録順や名前順に並べると「L, M, S, XL」のように
 * **直感に反する順序**になるため、既知のサイズはこの順に整列する。
 */
const SIZE_ORDER = [
  'XXS',
  'XS',
  'S',
  'M',
  'L',
  'XL',
  'XXL',
  '2XL',
  'XXXL',
  '3XL',
  '4XL',
  'F', // フリーサイズ
  'FREE',
  'ONESIZE',
];

/** 比較用にサイズ表記を正規化する (全角・空白・中黒などの揺れを吸収) */
function normalizeSize(size: string): string {
  return size
    .trim()
    .toUpperCase()
    // 全角英数字を半角へ
    .replace(/[Ａ-Ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s・_-]/g, '')
    .replace(/サイズ$/, '')
    .replace(/^フリー$/, 'FREE');
}

/**
 * サイズの並び順インデックス。既知でなければ null。
 */
export function sizeOrderIndex(size: string | null | undefined): number | null {
  const s = clean(size);
  if (!s) return null;
  const idx = SIZE_ORDER.indexOf(normalizeSize(s));
  return idx === -1 ? null : idx;
}

/**
 * サイズ順にバリエーションを並べ替える (非破壊)。
 *
 * - 既知のサイズ (S/M/L/XL…) は SIZE_ORDER の順
 * - 未知のサイズ同士は元の順序を保つ (安定ソート)
 * - 未知のサイズは既知サイズの後ろに置く
 */
export function sortBySize<T extends VariantLabelInput>(variants: readonly T[]): T[] {
  return variants
    .map((v, i) => ({ v, i, order: sizeOrderIndex(v.optionSize) }))
    .sort((a, b) => {
      if (a.order !== null && b.order !== null) {
        if (a.order !== b.order) return a.order - b.order;
        return a.i - b.i;
      }
      if (a.order !== null) return -1;
      if (b.order !== null) return 1;
      return a.i - b.i; // どちらも未知 → 元の順序
    })
    .map((x) => x.v);
}

/**
 * 商品がサイズ展開を持つか (サイズ選択 UI を出すべきか)。
 * 1 種類しか無い場合は選ばせる意味が無いので false。
 */
export function hasSizeOptions(variants: readonly VariantLabelInput[]): boolean {
  const sizes = new Set(
    variants.map((v) => clean(v.optionSize)).filter((s): s is string => s !== null),
  );
  return sizes.size > 1;
}

/**
 * 商品がカラー展開を持つか。
 */
export function hasColorOptions(variants: readonly VariantLabelInput[]): boolean {
  const colors = new Set(
    variants.map((v) => clean(v.optionColor)).filter((c): c is string => c !== null),
  );
  return colors.size > 1;
}
