/**
 * ec-product-option — 商品オプション (購入時入力項目) の検証・正規化 (純粋関数)
 *
 * 【背景】
 * 「宛名付きチェキ」のように、購入時に購入者から文字を入力してもらう必要がある
 * 商品がある (BASE の「商品オプション App」相当)。
 *
 *  - 商品ごとに複数のオプション (宛名 / 読み仮名 / 書いてほしい言葉 …) を定義できる
 *  - 必須 / 任意、最大文字数、追加料金 (1 個につき) を設定できる
 *  - 入力値はカート明細・注文明細に «その時点の値» としてスナップショット保存する
 *    (後からオプション定義を変えても過去の注文内容が変わらないように)
 *
 * 同じバリエーションでも宛名が違えば別の明細として扱いたいため、
 * 入力値から決定的なキー (optionsKey) を作って CartItem の一意性に使う。
 */

export interface ProductOptionLike {
  id: string;
  name: string;
  maxLength: number;
  price: number;
  isRequired: boolean;
  sortOrder: number;
}

/** カート/注文に保存するオプション入力値 (スナップショット) */
export interface OptionValueSnapshot {
  optionId: string;
  name: string;
  value: string;
  /** 1 個あたりの追加料金 (入力があった場合のみ加算) */
  price: number;
}

export type OptionValidation =
  | { ok: true; values: OptionValueSnapshot[]; extraPerUnit: number }
  | { ok: false; message: string };

/** 文字数は書記素ではなくコードポイントで数える (絵文字 1 文字を 2 と数えない) */
export function countChars(s: string): number {
  return Array.from(s).length;
}

/**
 * 購入者の入力 (optionId → 文字列) を商品のオプション定義で検証し、
 * 保存用スナップショットと 1 個あたりの追加料金を返す。
 *
 *  - 必須なのに空 → エラー
 *  - 最大文字数超過 → エラー
 *  - 定義に無い optionId は無視する (古いフォームからの送信など)
 *  - 任意で空のものはスナップショットに含めない
 */
export function validateOptionInputs(
  options: ProductOptionLike[],
  inputs: Record<string, string | null | undefined> | null | undefined,
): OptionValidation {
  const sorted = [...options].sort((a, b) => a.sortOrder - b.sortOrder);
  const values: OptionValueSnapshot[] = [];
  let extra = 0;
  for (const opt of sorted) {
    const raw = inputs?.[opt.id];
    const value = (raw ?? '').trim();
    if (value === '') {
      if (opt.isRequired) {
        return { ok: false, message: `「${opt.name}」を入力してください` };
      }
      continue;
    }
    if (countChars(value) > opt.maxLength) {
      return {
        ok: false,
        message: `「${opt.name}」は ${opt.maxLength} 文字以内で入力してください`,
      };
    }
    values.push({ optionId: opt.id, name: opt.name, value, price: opt.price });
    extra += opt.price;
  }
  return { ok: true, values, extraPerUnit: extra };
}

/**
 * スナップショットから一意キーを作る (同じ variant でも宛名が違えば別明細にするため)。
 * optionId 順に並べて決定的にする。入力なしは空文字。
 */
export function buildOptionsKey(values: OptionValueSnapshot[]): string {
  if (values.length === 0) return '';
  return [...values]
    .sort((a, b) => a.optionId.localeCompare(b.optionId))
    .map((v) => `${v.optionId}=${v.value}`)
    .join('\u001f');
}

/** 表示用: 「宛名: れいり / 書いてほしい言葉: ありがとう」 */
export function formatOptionValues(values: OptionValueSnapshot[] | null | undefined): string {
  if (!values || values.length === 0) return '';
  return values.map((v) => `${v.name}: ${v.value}`).join(' / ');
}

/** スナップショット配列の合計追加料金 (1 個あたり) */
export function sumOptionExtra(values: OptionValueSnapshot[] | null | undefined): number {
  if (!values) return 0;
  return values.reduce((s, v) => s + (v.price || 0), 0);
}

/**
 * DB の Json カラムから読み出した値を安全に OptionValueSnapshot[] に戻す。
 * 不正な形は空配列にする (壊れたデータで購入フローを落とさない)。
 */
export function parseOptionValues(raw: unknown): OptionValueSnapshot[] {
  if (!Array.isArray(raw)) return [];
  const out: OptionValueSnapshot[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.optionId !== 'string' || typeof o.name !== 'string' || typeof o.value !== 'string') {
      continue;
    }
    out.push({
      optionId: o.optionId,
      name: o.name,
      value: o.value,
      price: typeof o.price === 'number' && Number.isFinite(o.price) ? o.price : 0,
    });
  }
  return out;
}
