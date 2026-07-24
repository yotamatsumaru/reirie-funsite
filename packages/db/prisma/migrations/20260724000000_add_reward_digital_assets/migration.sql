-- デジタル特典 (DIGITAL) 配布ファイル用テーブルの追加 (2026-07)
--
-- 新規テーブル `reward_digital_assets` の追加のみ。既存テーブルへの
-- 破壊的変更を含まないため安全に適用できる。
--
-- 対応する schema.prisma の変更:
--   model RewardDigitalAsset (新規)
--   RewardCatalogItem.digitalAssets (逆リレーション・DB 影響なし)

-- CreateTable
CREATE TABLE "reward_digital_assets" (
    "id" UUID NOT NULL,
    "catalog_item_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "url" TEXT,
    "data" BYTEA,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_digital_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reward_digital_assets_catalog_item_id_sort_order_idx" ON "reward_digital_assets"("catalog_item_id", "sort_order");

-- AddForeignKey
ALTER TABLE "reward_digital_assets" ADD CONSTRAINT "reward_digital_assets_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "reward_catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
