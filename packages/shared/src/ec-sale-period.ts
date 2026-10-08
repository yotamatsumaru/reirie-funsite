/**
 * ec-sale-period — 商品の販売期間 (発売開始 / 販売終了) の判定 (純粋関数)
 *
 * 【背景】
 * 以前は「公開 / 非公開」のフラグしかなく、
 *   - 複数商品を同じ時刻に一斉発売するには運営が手動で公開ボタンを押して回る
 *   - 発売前に商品ページを見せておく (予告) ことができない
 * という問題があった。
 *
 * BASE の「販売期間」と同様に、
 *   isActive=true かつ saleStartsAt が未来  → 「発売前」: ページは見える・購入不可
 *   isActive=true かつ saleEndsAt を過ぎた  → 「販売終了」: ページは見える・購入不可
 *   isActive=true かつ期間内 (または未設定) → 「販売中」
 *   isActive=false                         → 「非公開」: ページ自体が 404
 * とする。時刻になれば自動的に購入可能になる (手動操作不要)。
 */

export type SaleStatus = 'HIDDEN' | 'UPCOMING' | 'ON_SALE' | 'ENDED';

export interface SalePeriodLike {
  isActive: boolean;
  saleStartsAt?: Date | string | null;
  saleEndsAt?: Date | string | null;
}

function toTime(v: Date | string | null | undefined): number | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

/** 現在時刻 (now) における販売状態を返す */
export function getSaleStatus(p: SalePeriodLike, now: Date = new Date()): SaleStatus {
  if (!p.isActive) return 'HIDDEN';
  const t = now.getTime();
  const start = toTime(p.saleStartsAt);
  const end = toTime(p.saleEndsAt);
  if (start != null && t < start) return 'UPCOMING';
  if (end != null && t >= end) return 'ENDED';
  return 'ON_SALE';
}

/** 購入 (カート追加 / チェックアウト) ができる状態か */
export function isPurchasable(p: SalePeriodLike, now: Date = new Date()): boolean {
  return getSaleStatus(p, now) === 'ON_SALE';
}

/** 商品ページを表示してよい状態か (発売前 / 販売終了 でもページは見せる) */
export function isViewable(p: SalePeriodLike): boolean {
  return p.isActive;
}

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  HIDDEN: '非公開',
  UPCOMING: '発売前',
  ON_SALE: '販売中',
  ENDED: '販売終了',
};

/**
 * 発売開始・終了の整合性チェック。
 * 終了が開始より前なら設定ミスなのでエラーメッセージを返す (OK なら null)。
 */
export function validateSalePeriod(
  saleStartsAt: Date | string | null | undefined,
  saleEndsAt: Date | string | null | undefined,
): string | null {
  const s = toTime(saleStartsAt);
  const e = toTime(saleEndsAt);
  if (saleStartsAt != null && s == null) return '販売開始日時の形式が不正です';
  if (saleEndsAt != null && e == null) return '販売終了日時の形式が不正です';
  if (s != null && e != null && e <= s) return '販売終了日時は販売開始日時より後にしてください';
  return null;
}
