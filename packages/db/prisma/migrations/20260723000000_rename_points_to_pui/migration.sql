-- DataMigration + Rename (2026-07)
-- 通貨名を「Fan ポイント」から「Pui」へ変更する。
--
-- 既存の RewardPointPack / RewardPointPurchase / RewardCatalogItem /
-- RewardRedemption / MonthlyRewardPointGrant といった「レガシーなモデル・
-- テーブル名」自体は変更しない (既存の設計判断を維持)。
-- 変更するのは、通貨そのものを表す enum / テーブル名 / カラム名のみ。
--
-- 対応する schema.prisma の変更:
--   PointReason (enum)                    -> PuiReason
--   users.points                          -> users.pui
--   point_transactions (table)            -> pui_transactions
--   game_scenarios.fan_point_price        -> game_scenarios.pui_price
--   game_items.fan_point_price            -> game_items.pui_price
--   player_purchases.fan_point_amount     -> player_purchases.pui_amount
--   reward_point_packs.points             -> reward_point_packs.pui
--   reward_point_purchases.points         -> reward_point_purchases.pui
--   reward_catalog_items.point_cost       -> reward_catalog_items.pui_cost
--   reward_redemptions.point_cost         -> reward_redemptions.pui_cost
--   mini_game_plays.reward_point          -> mini_game_plays.reward_pui
--   monthly_reward_point_grants.points    -> monthly_reward_point_grants.pui
--   mini_game_extra_play_purchases.total_fan_points_spent
--                                         -> mini_game_extra_play_purchases.total_pui_spent
--
-- 前提: このマイグレーションは 20260721002000_drop_reward_point_currency_columns
-- (Fan ポイント/特典ポイント統合) が適用済みであること。

-- =====================================================================
-- 1) Enum のリネーム
-- =====================================================================

ALTER TYPE "PointReason" RENAME TO "PuiReason";

-- GamePurchasePayMethod の 'FAN_POINT' 値を 'PUI' へ改名。
ALTER TYPE "GamePurchasePayMethod" RENAME VALUE 'FAN_POINT' TO 'PUI';

-- =====================================================================
-- 2) テーブル本体のリネーム (point_transactions -> pui_transactions)
-- =====================================================================

ALTER TABLE "point_transactions" RENAME TO "pui_transactions";

-- Prisma が生成する既定の制約/インデックス名も追随させる。
ALTER TABLE "pui_transactions" RENAME CONSTRAINT "point_transactions_pkey" TO "pui_transactions_pkey";
ALTER TABLE "pui_transactions" RENAME CONSTRAINT "point_transactions_user_id_fkey" TO "pui_transactions_user_id_fkey";
ALTER INDEX "point_transactions_user_id_created_at_idx" RENAME TO "pui_transactions_user_id_created_at_idx";

-- =====================================================================
-- 3) カラムのリネーム
-- =====================================================================

ALTER TABLE "users" RENAME COLUMN "points" TO "pui";

ALTER TABLE "game_scenarios" RENAME COLUMN "fan_point_price" TO "pui_price";
ALTER TABLE "game_items" RENAME COLUMN "fan_point_price" TO "pui_price";
ALTER TABLE "player_purchases" RENAME COLUMN "fan_point_amount" TO "pui_amount";

ALTER TABLE "reward_point_packs" RENAME COLUMN "points" TO "pui";
ALTER TABLE "reward_point_purchases" RENAME COLUMN "points" TO "pui";

ALTER TABLE "reward_catalog_items" RENAME COLUMN "point_cost" TO "pui_cost";
ALTER TABLE "reward_redemptions" RENAME COLUMN "point_cost" TO "pui_cost";

ALTER TABLE "mini_game_plays" RENAME COLUMN "reward_point" TO "reward_pui";

ALTER TABLE "monthly_reward_point_grants" RENAME COLUMN "points" TO "pui";

ALTER TABLE "mini_game_extra_play_purchases" RENAME COLUMN "total_fan_points_spent" TO "total_pui_spent";
