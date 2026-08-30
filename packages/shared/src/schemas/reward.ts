/**
 * 景品カタログ・交換・Pui 購入 (Stripe) 関連の Zod スキーマ・定数・ラベル定義。
 *
 * 【2026-07 統合】以前は Fan ポイントと特典ポイント (Stripe 購入 / サブスク月次自動付与で貯まり
 * 景品カタログ交換に使う別枠の通貨。旧 User.rewardPoints / RewardPointTransaction /
 * RewardPointReason) の 2 種類があったが、Fan ポイント 1 種類に統合した。
 * 特典ポイント取引理由 (旧 RewardPointReason) は PuiReason (packages/shared/src/membership.ts)
 * に統合済みのため、このファイルにあった REWARD_POINT_REASONS 等は削除した。
 * 【2026-07 通貨名変更】さらに通貨名を「Fan ポイント」から「Pui」へ変更した。
 * 景品カタログ・交換・購入パック等の型/テーブル名 (RewardCatalogItem 等) はそのまま維持し、
 * 実際に増減するのは User.pui / PuiTransaction (Pui) である。
 */
import { z } from 'zod';
import { PLAN_TYPES, type PlanTypeLiteral } from '../constants';

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

// ---------------------------------------------------------------------
// デジタル特典 (DIGITAL) 配布ファイル (RewardDigitalAsset)
// ---------------------------------------------------------------------

/**
 * デジタル特典としてアップロード可能な画像 MIME タイプ → 拡張子。
 * 壁紙 (スマホ / PC) 配布を主用途とするため画像のみ許可する。
 */
export const REWARD_DIGITAL_ASSET_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** 1 ファイルあたりの上限 (壁紙の高解像度に配慮し 20MB) */
export const MAX_REWARD_DIGITAL_ASSET_BYTES = 20 * 1024 * 1024;

/** 1 つの景品に紐づけられる最大ファイル数 */
export const MAX_REWARD_DIGITAL_ASSETS_PER_ITEM = 20;

/** デジタル特典 (ダウンロード配布) を持つ種別か */
export function isDigitalDelivery(kind: RewardCatalogItemKindLiteral): boolean {
  return kind === 'DIGITAL';
}

/**
 * 同じ景品を 1 会員につき 1 回しか交換できない種別か。
 *
 * 【なぜ種別で分けるのか】
 * 「2 回買えてしまうのはバグ」なのは DIGITAL (壁紙などのダウンロード配布) だけ。
 * デジタル特典は一度交換すれば以後いつでも何度でもダウンロードできるので、
 * 2 回目の交換は Pui を払っても新たに得るものが何もない = 会員の純損失になる。
 * これが「Pui の重複使用」の実害である。
 *
 * 逆に GOODS (物品) と CALL_PRIORITY (特典会優先枠) は、
 * 「同じグッズを 2 個ほしい」「次回の特典会でも優先枠を取りたい」が正当な要求なので、
 * 一律に 1 回だけへ制限すると既存の運用を壊す。したがって制限しない。
 *
 * 在庫 (stock) で個数を絞りたい場合は従来どおりカタログ側の在庫設定で行う。
 */
export function isOncePerUserKind(kind: RewardCatalogItemKindLiteral): boolean {
  return kind === 'DIGITAL';
}

/**
 * すでに交換済みの景品を、もう一度交換しようとしていないかを判定する。
 *
 * @param kind 景品の種別
 * @param existingActiveRedemptions その会員がこの景品について持っている
 *        「有効な」交換の件数 (CANCELED は Pui が返還済みなので数に入れない)
 * @returns true = 交換を拒否すべき (すでに持っている)
 *
 * キャンセル済みを除外しているのは、運営がキャンセル (= Pui 返還) した後は
 * 会員がもう一度交換できないと詰んでしまうため。
 */
export function isDuplicateRedemption(
  kind: RewardCatalogItemKindLiteral,
  existingActiveRedemptions: number,
): boolean {
  if (!isOncePerUserKind(kind)) return false;
  return existingActiveRedemptions > 0;
}

/**
 * 交換済みのデジタル特典を「もう一度ダウンロードする」ことは常に許可される。
 *
 * ダウンロード回数に上限を設けない方針を、判定関数として明示しておく
 * (将来 uploader 都合で上限を入れたくなったとき、変更点が 1 箇所で済むように)。
 * 交換済み = 買い切りなので、機種変更・PC 買い替え・保存ミスでも
 * 会員が Pui を再度払う必要はない。
 */
export function canRedownloadDigitalAsset(hasActiveRedemption: boolean): boolean {
  return hasActiveRedemption;
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
// Pui 購入 (Stripe)
// ---------------------------------------------------------------------

export const REWARD_POINT_PURCHASE_STATUSES = [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
] as const;
export type RewardPointPurchaseStatusLiteral = (typeof REWARD_POINT_PURCHASE_STATUSES)[number];

// ---------------------------------------------------------------------
// ゲーム内購入の決済手段 (Pui / Stripe)
// ---------------------------------------------------------------------

export const GAME_PURCHASE_PAY_METHODS = ['STRIPE', 'PUI'] as const;
export type GamePurchasePayMethodLiteral = (typeof GAME_PURCHASE_PAY_METHODS)[number];

// ---------------------------------------------------------------------
// サブスク月次 Pui 自動付与
// ---------------------------------------------------------------------

/**
 * サブスクプラン別の月次 Pui 自動付与量。
 *  - FREE     : 0 (対象外)
 *  - STANDARD : 300 Pui/月
 *  - PREMIUM  : 1000 Pui/月
 */
export const MONTHLY_PUI_BONUS: Record<PlanTypeLiteral, number> = {
  FREE: 0,
  STANDARD: 300,
  PREMIUM: 1000,
};

// ---------------------------------------------------------------------
// ミニゲーム追加プレイ購入 (Pui)
// ---------------------------------------------------------------------

/** 1 回の追加プレイ購入で消費する Pui */
export const EXTRA_PLAY_COST_PUI = 50;

/** 1 日に追加購入できる最大回数 (通常の無料プレイ回数とは別枠) */
export const MAX_EXTRA_PLAYS_PER_DAY = 5;

// ---------------------------------------------------------------------
// API 入力スキーマ
// ---------------------------------------------------------------------

/** Pui パックの管理 (作成・編集) */
export const AdminRewardPointPackInputSchema = z.object({
  name: z.string().min(1).max(80),
  pui: z.number().int().min(1).max(1_000_000),
  priceJpy: z.number().int().min(1).max(1_000_000),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export type AdminRewardPointPackInput = z.infer<typeof AdminRewardPointPackInputSchema>;

/** Pui 購入 (Stripe Checkout Session 作成) */
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
  puiCost: z.number().int().min(1).max(1_000_000),
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

/** ミニゲーム追加プレイの購入 (Pui 消費) */
export const BuyExtraPlayInputSchema = z.object({
  gameType: z.literal('ACCHI_MUITE_HOI').default('ACCHI_MUITE_HOI'),
});
export type BuyExtraPlayInput = z.infer<typeof BuyExtraPlayInputSchema>;

/** 恋愛ADVの章/アイテム購入時の決済手段指定 (GamePurchaseInputSchema の拡張フィールド) */
export const GamePurchasePayMethodSchema = z.enum(GAME_PURCHASE_PAY_METHODS).default('STRIPE');

// 全プラン分を必須にした月次 Pui 付与のスキーマ（管理画面での設定変更に備え定義のみ用意）
export const MonthlyPuiBonusSchema = z.object(
  Object.fromEntries(
    PLAN_TYPES.map((p) => [p, z.number().int().min(0).max(1_000_000)]),
  ) as Record<PlanTypeLiteral, z.ZodNumber>,
) as unknown as z.ZodType<Record<PlanTypeLiteral, number>>;
