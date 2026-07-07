-- CreateTable: サイト内の差し替え可能画像 (トップページのヒーロー画像等)
-- slot ごとに 1 件。GameAudio と同じく S3 未設定時は data にバイト列を保存し
-- /api/media/site-image/{id} 経由で配信する。
CREATE TABLE "site_images" (
    "id" UUID NOT NULL,
    "slot" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "content_type" TEXT,
    "file_name" TEXT,
    "size_bytes" INTEGER,
    "data" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "site_images_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "site_images_slot_key" ON "site_images"("slot");
