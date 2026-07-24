-- デジタル特典ダウンロード履歴テーブルの追加 (2026-07)
--
-- 新規テーブル `reward_download_logs` の追加のみ。既存テーブルへの
-- 破壊的変更を含まないため安全に適用できる。
--
-- 対応する schema.prisma の変更:
--   model RewardDownloadLog (新規)
--   RewardCatalogItem.downloadLogs / User.rewardDownloadLogs (逆リレーション・DB 影響なし)

-- CreateTable
CREATE TABLE "reward_download_logs" (
    "id" UUID NOT NULL,
    "catalog_item_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_download_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reward_download_logs_catalog_item_id_created_at_idx" ON "reward_download_logs"("catalog_item_id", "created_at");

-- CreateIndex
CREATE INDEX "reward_download_logs_catalog_item_id_user_id_idx" ON "reward_download_logs"("catalog_item_id", "user_id");

-- AddForeignKey
ALTER TABLE "reward_download_logs" ADD CONSTRAINT "reward_download_logs_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "reward_catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_download_logs" ADD CONSTRAINT "reward_download_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
