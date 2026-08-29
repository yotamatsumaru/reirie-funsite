-- MyRoom (家具の部屋): 家具マスタテーブル
--
-- 運営が管理画面から追加する「家具の種類」を保持する。会員が実際に部屋へ
-- 配置した家具は別テーブル (PR2 で追加) に持つ。マスタと配置を分けることで、
-- 価格や画像を後から差し替えても既に購入した会員の部屋が壊れない。

-- CreateEnum
CREATE TYPE "MyRoomFurnitureCategory" AS ENUM ('FLOOR', 'WALL', 'DESKTOP', 'RUG', 'PLANT', 'OTHER');

-- CreateEnum
CREATE TYPE "MyRoomFurnitureStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "myroom_furnitures" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "MyRoomFurnitureCategory" NOT NULL,
    "status" "MyRoomFurnitureStatus" NOT NULL DEFAULT 'DRAFT',
    "pui_cost" INTEGER NOT NULL DEFAULT 0,
    "width_cells" INTEGER NOT NULL DEFAULT 1,
    "height_cells" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "image_url" TEXT,
    "content_type" TEXT,
    "file_name" TEXT,
    "size_bytes" INTEGER,
    "data" BYTEA,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "myroom_furnitures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- 会員向けショップ (status = PUBLISHED を並び順で取得) の主経路。
CREATE INDEX "myroom_furnitures_status_sort_order_idx" ON "myroom_furnitures"("status", "sort_order");

-- CreateIndex
-- 管理画面と会員向けショップの分類別タブ用。
CREATE INDEX "myroom_furnitures_category_sort_order_idx" ON "myroom_furnitures"("category", "sort_order");

-- AddForeignKey
-- 追加した運営アカウントが退会しても家具そのものは残す (SET NULL)。
ALTER TABLE "myroom_furnitures" ADD CONSTRAINT "myroom_furnitures_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
