-- CreateEnum
CREATE TYPE "RewardPointReason" AS ENUM ('STRIPE_PURCHASE', 'SUBSCRIPTION_BONUS', 'ADMIN_ADJUST', 'REDEMPTION', 'REFUND', 'OTHER');

-- CreateEnum
CREATE TYPE "RewardPointPurchaseStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "RewardCatalogItemStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RewardCatalogItemKind" AS ENUM ('GOODS', 'CALL_PRIORITY', 'DIGITAL');

-- CreateEnum
CREATE TYPE "RewardRedemptionStatus" AS ENUM ('PENDING', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "GamePurchasePayMethod" AS ENUM ('STRIPE', 'FAN_POINT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PointReason" ADD VALUE 'ITEM_PURCHASE';
ALTER TYPE "PointReason" ADD VALUE 'EXTRA_PLAY_PURCHASE';

-- AlterTable
ALTER TABLE "game_items" ADD COLUMN     "fan_point_price" INTEGER;

-- AlterTable
ALTER TABLE "game_scenarios" ADD COLUMN     "fan_point_price" INTEGER;

-- AlterTable
ALTER TABLE "player_purchases" ADD COLUMN     "fan_point_amount" INTEGER,
ADD COLUMN     "pay_method" "GamePurchasePayMethod" NOT NULL DEFAULT 'STRIPE';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "reward_points" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "reward_point_transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "reason" "RewardPointReason" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_point_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_point_packs" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "price_jpy" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_point_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_point_purchases" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "pack_id" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "amount_jpy" INTEGER NOT NULL,
    "status" "RewardPointPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "stripe_payment_intent_id" TEXT,
    "stripe_checkout_session_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_point_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_catalog_items" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "RewardCatalogItemKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "point_cost" INTEGER NOT NULL,
    "stock" INTEGER,
    "status" "RewardCatalogItemStatus" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_redemptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "catalog_item_id" UUID NOT NULL,
    "item_name" TEXT NOT NULL,
    "item_kind" "RewardCatalogItemKind" NOT NULL,
    "point_cost" INTEGER NOT NULL,
    "status" "RewardRedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "shipping_name" TEXT,
    "shipping_phone" TEXT,
    "shipping_postal_code" TEXT,
    "shipping_prefecture" TEXT,
    "shipping_address_1" TEXT,
    "shipping_address_2" TEXT,
    "tracking_number" TEXT,
    "admin_note" TEXT,
    "shipped_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mini_game_extra_play_purchases" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "game_type" "MiniGameType" NOT NULL,
    "date" TEXT NOT NULL,
    "purchased_count" INTEGER NOT NULL DEFAULT 0,
    "total_fan_points_spent" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mini_game_extra_play_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reward_point_transactions_user_id_created_at_idx" ON "reward_point_transactions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "reward_point_packs_is_active_sort_order_idx" ON "reward_point_packs"("is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "reward_point_purchases_stripe_payment_intent_id_key" ON "reward_point_purchases"("stripe_payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "reward_point_purchases_stripe_checkout_session_id_key" ON "reward_point_purchases"("stripe_checkout_session_id");

-- CreateIndex
CREATE INDEX "reward_point_purchases_user_id_created_at_idx" ON "reward_point_purchases"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "reward_point_purchases_status_idx" ON "reward_point_purchases"("status");

-- CreateIndex
CREATE UNIQUE INDEX "reward_catalog_items_slug_key" ON "reward_catalog_items"("slug");

-- CreateIndex
CREATE INDEX "reward_catalog_items_status_sort_order_idx" ON "reward_catalog_items"("status", "sort_order");

-- CreateIndex
CREATE INDEX "reward_catalog_items_kind_idx" ON "reward_catalog_items"("kind");

-- CreateIndex
CREATE INDEX "reward_redemptions_user_id_created_at_idx" ON "reward_redemptions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "reward_redemptions_status_created_at_idx" ON "reward_redemptions"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "mini_game_extra_play_purchases_user_id_game_type_date_key" ON "mini_game_extra_play_purchases"("user_id", "game_type", "date");

-- AddForeignKey
ALTER TABLE "reward_point_transactions" ADD CONSTRAINT "reward_point_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_point_purchases" ADD CONSTRAINT "reward_point_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_point_purchases" ADD CONSTRAINT "reward_point_purchases_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "reward_point_packs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "reward_catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mini_game_extra_play_purchases" ADD CONSTRAINT "mini_game_extra_play_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

