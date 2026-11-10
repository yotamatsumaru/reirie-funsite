/**
 * Mero (メロ) — Pui の上位ポイント。
 *
 * 【位置づけ】
 *   Pui  … ログインボーナス・ミニゲーム・SNS シェアなどで日常的に貯まるポイント
 *   Mero … ライブ特典・オンライン物販の特典など「より価値の高い体験」に結びつく上位ポイント
 *
 * Pui とは残高も履歴も別管理にしている (User.mero / MeroTransaction)。
 * 同じ残高に混ぜると、日常的に貯まる Pui で上位特典が交換できてしまうため。
 *
 * 【現在の状態 / 非公開】
 * site.sectionVisibility.meroVisible (既定 false) で一般会員からは隠している。
 * 非公開の間も管理者 (ADMIN 以上) は残高画面をプレビューでき、
 * スーパー管理者は管理画面から付与・調整できる (運用テスト用)。
 *
 * 付与・消費の実処理はサーバー側の apps/web/src/lib/mero.ts に集約している。
 * このファイルは「サーバー / クライアントどちらからも使う定義」だけを置く。
 */
import { z } from 'zod';

/** 通貨の表示名 */
export const MERO_LABEL = 'Mero';

/**
 * 1 取引で動かせる Mero の上限。
 * Mero は上位ポイントで 1 単位の価値が大きい想定のため、
 * 誤入力 (桁の打ち間違い) による大量付与を防ぐ目的で Pui (1,000,000) より小さくしている。
 */
export const MAX_MERO_PER_TX = 100_000;

/**
 * Mero 取引の amount が安全な範囲か検証する。
 *  - 整数であること
 *  - 0 でないこと
 *  - |amount| <= MAX_MERO_PER_TX
 */
export function isValidMeroAmount(amount: number): boolean {
  return Number.isInteger(amount) && amount !== 0 && Math.abs(amount) <= MAX_MERO_PER_TX;
}

/** Mero 取引の理由 (Prisma の MeroReason と一致させること) */
export const MERO_REASONS = [
  'ADMIN_ADJUST',
  'LIVE_BENEFIT',
  'MERCH_BENEFIT',
  'REDEMPTION',
  'REFUND',
  'OTHER',
] as const;
export type MeroReasonLiteral = (typeof MERO_REASONS)[number];

/** 画面表示用の理由ラベル */
export const MERO_REASON_LABELS: Record<MeroReasonLiteral, string> = {
  ADMIN_ADJUST: '運営による調整',
  LIVE_BENEFIT: 'ライブ特典',
  MERCH_BENEFIT: 'オンライン物販特典',
  REDEMPTION: '特典との交換',
  REFUND: '交換キャンセルによる返還',
  OTHER: 'その他',
};

/**
 * 管理画面から手動で選べる理由。
 * REDEMPTION / REFUND は特典交換の処理から自動で記録するものなので、手動では選ばせない
 * (手で選べると、実際には交換していないのに「交換済み」の履歴を作れてしまう)。
 */
export const MERO_MANUAL_REASONS = [
  'LIVE_BENEFIT',
  'MERCH_BENEFIT',
  'ADMIN_ADJUST',
  'OTHER',
] as const satisfies readonly MeroReasonLiteral[];
export type MeroManualReasonLiteral = (typeof MERO_MANUAL_REASONS)[number];

/** 管理者による Mero 付与 / 減算の入力 */
export const AdminAdjustMeroSchema = z.object({
  userId: z.string().uuid(),
  amount: z
    .number()
    .int('整数で指定してください')
    .refine((n) => n !== 0, '0 以外を指定してください')
    .refine(
      (n) => Math.abs(n) <= MAX_MERO_PER_TX,
      `1 回で動かせる Mero は ±${MAX_MERO_PER_TX.toLocaleString('ja-JP')} までです`,
    ),
  reason: z.enum(MERO_MANUAL_REASONS),
  /** ライブ名・注文番号・調整理由など (履歴に残る) */
  note: z.string().trim().max(200).optional(),
});
export type AdminAdjustMero = z.infer<typeof AdminAdjustMeroSchema>;
