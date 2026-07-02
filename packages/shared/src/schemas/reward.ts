/**
 * 特典ポイント (Reward Point) 関連の Zod スキーマ・定数・ラベル定義。
 *
 * 2 段階ポイント体系:
 *  - Fan ポイント     : ログイン等で無料で貯まり、ゲーム内 (章/アイテム購入・追加プレイ) で使う。
 *                        既存の User.points / PointTransaction をそのまま使用する (packages/shared/src/membership.ts)。
 *  - 特典ポイント     : Stripe 購入 or サブスク月次自動付与で貯まり、景品カタログとの交換に使う。
 *                        User.rewardPoints / RewardPointTransaction が真実の残高。
 */
import { z } from 'zod';
import { PLAN_TYPES, type PlanTypeLiteral } from '../constants';

// ---------------------------------------------------------------------
// 特典ポイント取引理由 (RewardPointReason)
// ---------------------------------------------------------------------

export const REWARD_POINT_REASONS = [
  'STRIPE_PURCHASE',
  'SUBSCRIPTION_BONUS',
  'ADMIN_ADJUST',
  'REDEMPTION',
  'REFUND',
  'OTHER',
] as const;
export type RewardPointReasonLiteral = (typeof REWARD_POINT_REASONS)[number];

export const REWARD_POINT_REASON_LABELS: Record<RewardPointReasonLiteral, string> = {
  STRIPE_PURCHASE: 'ポイントパック購入',
  SUBSCRIPTION_BONUS: 'サブスク月次特典',
  ADMIN_ADJUST: '運営による調整',
  REDEMPTION: '景品交換',
  REFUND: '交換キャンセル返還',
  OTHER: 'その他',
};

// ---------------------------------------------------------------------
// 景品カタログ (RewardCatalogItem)
// ---------------------------------------------------------------------

export const REWARD_CATALOG_ITEM_KINDS = ['GOODS', 'CALL_PRIORITY', 'DIGITAL'] as const;
export type RewardCatalogItemKindLiteral = (typeof REWARD_CATALOG_ITEM_KINDS)[number];

export const REWARD_CATALOG_ITEM_KIND_LABELS: Record<RewardCatalogItemKindLiteral, string> = {
  GOODS: 'グッズ (発送)',
  CALL_PRIORITY: '特典会優先枠',
  DIGITAL: 'デジタル特典',
};

/** 発送 (住所) が必要な種別か */
export function requiresShipping(kind: RewardCatalogItemKindLiteral): boolean {
  return kind === 'GOODS';
}

export const REWARD_CATALOG_ITEM_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type RewardCatalogItemStatusLiteral = (typeof REWARD_CATALOG_ITEM_STATUSES)[number];

export const REWARD_CATALOG_ITEM_STATUS_LABELS: Record<RewardCatalogItemStatusLiteral, string> = {
  DRAFT: '下書き',
  PUBLISHED: '公開中',
  ARCHIVED: 'アーカイブ',
};

// ---------------------------------------------------------------------
// 景品交換 (発送管理フロー)
// ---------------------------------------------------------------------

export const REWARD_REDEMPTION_STATUSES = [
  'PENDING',
  'PROCESSING',
  'SHIPPED',
  'COMPLETED',
  'CANCELED',
] as const;
export type RewardRedemptionStatusLiteral = (typeof REWARD_REDEMPTION_STATUSES)[number];

export const REWARD_REDEMPTION_STATUS_LABELS: Record<RewardRedemptionStatusLiteral, string> = {
  PENDING: '受付済み・処理待ち',
  PROCESSING: '発送準備中',
  SHIPPED: '発送済み',
  COMPLETED: '完了',
  CANCELED: 'キャンセル',
};

/**
 * 発送管理フローの正しい遷移先を返す (逆行・飛び越しを防ぐバリデーション用)。
 * CANCELED へは PENDING / PROCESSING からのみ許可 (発送後のキャンセルは運営判断で個別対応)。
 */
export const REWARD_REDEMPTION_STATUS_TRANSITIONS: Record<
  RewardRedemptionStatusLiteral,
  RewardRedemptionStatusLiteral[]
> = {
  PENDING: ['PROCESSING', 'CANCELED', 'COMPLETED'],
  PROCESSING: ['SHIPPED', 'CANCELED'],
  SHIPPED: ['COMPLETED'],
  COMPLETED: [],
  CANCELED: [],
};

export function canTransitionRedemptionStatus(
  from: RewardRedemptionStatusLiteral,
  to: RewardRedemptionStatusLiteral,
): boolean {
  if (from === to) return false;
  return REWARD_REDEMPTION_STATUS_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------
// 特典ポイント購入 (Stripe)
// ---------------------------------------------------------------------

export const REWARD_POINT_PURCHASE_STATUSES = [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
] as const;
export type RewardPointPurchaseStatusLiteral = (typeof REWARD_POINT_PURCHASE_STATUSES)[number];

// ---------------------------------------------------------------------
// ゲーム内購入の決済手段 (Fan ポイント / Stripe)
// ---------------------------------------------------------------------

export const GAME_PURCHASE_PAY_METHODS = ['STRIPE', 'FAN_POINT'] as const;
export type GamePurchasePayMethodLiteral = (typeof GAME_PURCHASE_PAY_METHODS)[number];

// ---------------------------------------------------------------------
// サブスク月次 特典ポイント自動付与
// ---------------------------------------------------------------------

/**
 * サブスクプラン別の月次特典ポイント自動付与量。
 *  - FREE     : 0 (対象外)
 *  - STANDARD : 300pt/月
 *  - PREMIUM  : 1000pt/月
 */
export const MONTHLY_REWARD_POINT_BONUS: Record<PlanTypeLiteral, number> = {
  FREE: 0,
  STANDARD: 300,
  PREMIUM: 1000,
};

// ---------------------------------------------------------------------
// ミニゲーム追加プレイ購入 (Fan ポイント)
// ---------------------------------------------------------------------

/** 1 回の追加プレイ購入で消費する Fan ポイント */
export const EXTRA_PLAY_COST_FAN_POINTS = 50;

/** 1 日に追加購入できる最大回数 (通常の無料プレイ回数とは別枠) */
export const MAX_EXTRA_PLAYS_PER_DAY = 5;

// ---------------------------------------------------------------------
// API 入力スキーマ
// ---------------------------------------------------------------------

/** 管理者による特典ポイント手動調整 */
export const AdminAdjustRewardPointsSchema = z.object({
  userId: z.uuid(),
  amount: z.number().int().refine((n) => n !== 0, '0 以外を指定してください'),
  note: z.string().max(200).optional(),
});
export type AdminAdjustRewardPointsInput = z.infer<typeof AdminAdjustRewardPointsSchema>;

/** 特典ポイントパックの管理 (作成・編集) */
export const AdminRewardPointPackInputSchema = z.object({
  name: z.string().min(1).max(80),
  points: z.number().int().min(1).max(1_000_000),
  priceJpy: z.number().int().min(1).max(1_000_000),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export type AdminRewardPointPackInput = z.infer<typeof AdminRewardPointPackInputSchema>;

/** 特典ポイント購入 (Stripe Checkout Session 作成) */
export const RewardPointPurchaseInputSchema = z.object({
  packId: z.uuid(),
  successUrl: z.url(),
  cancelUrl: z.url(),
});
export type RewardPointPurchaseInput = z.infer<typeof RewardPointPurchaseInputSchema>;

/** 景品カタログの管理 (作成・編集) */
export const AdminRewardCatalogItemInputSchema = z.object({
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, 'slug は半角英数とハイフンのみ'),
  kind: z.enum(REWARD_CATALOG_ITEM_KINDS),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  imageUrl: z.url().optional(),
  pointCost: z.number().int().min(1).max(1_000_000),
  stock: z.number().int().min(0).max(1_000_000).nullable().optional(),
  status: z.enum(REWARD_CATALOG_ITEM_STATUSES).default('DRAFT'),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export type AdminRewardCatalogItemInput = z.infer<typeof AdminRewardCatalogItemInputSchema>;

/** 会員による景品交換申請 */
export const RedeemRewardCatalogItemInputSchema = z.object({
  catalogItemId: z.uuid(),
  // GOODS (発送必要) のときのみ必須。未指定時は User の登録住所を利用する想定。
  shippingName: z.string().min(1).max(80).optional(),
  shippingPhone: z.string().min(1).max(20).optional(),
  shippingPostalCode: z.string().min(1).max(10).optional(),
  shippingPrefecture: z.string().min(1).max(10).optional(),
  shippingAddress1: z.string().min(1).max(200).optional(),
  shippingAddress2: z.string().max(200).optional(),
});
export type RedeemRewardCatalogItemInput = z.infer<typeof RedeemRewardCatalogItemInputSchema>;

/** 管理者による発送管理ステータス更新 */
export const AdminUpdateRedemptionStatusSchema = z.object({
  status: z.enum(REWARD_REDEMPTION_STATUSES),
  trackingNumber: z.string().max(80).optional(),
  adminNote: z.string().max(2000).optional(),
});
export type AdminUpdateRedemptionStatusInput = z.infer<typeof AdminUpdateRedemptionStatusSchema>;

/** ミニゲーム追加プレイの購入 (Fan ポイント消費) */
export const BuyExtraPlayInputSchema = z.object({
  gameType: z.literal('ACCHI_MUITE_HOI').default('ACCHI_MUITE_HOI'),
});
export type BuyExtraPlayInput = z.infer<typeof BuyExtraPlayInputSchema>;

/** 恋愛ADVの章/アイテム購入時の決済手段指定 (GamePurchaseInputSchema の拡張フィールド) */
export const GamePurchasePayMethodSchema = z.enum(GAME_PURCHASE_PAY_METHODS).default('STRIPE');

// 全プラン分を必須にした月次特典ポイントのスキーマ（管理画面での設定変更に備え定義のみ用意）
export const MonthlyRewardPointBonusSchema = z.object(
  Object.fromEntries(
    PLAN_TYPES.map((p) => [p, z.number().int().min(0).max(1_000_000)]),
  ) as Record<PlanTypeLiteral, z.ZodNumber>,
) as unknown as z.ZodType<Record<PlanTypeLiteral, number>>;
