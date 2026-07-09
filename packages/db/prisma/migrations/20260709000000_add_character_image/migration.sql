-- CreateTable: あっち向いてホイのキャラクター画像 (ポーズごとの差し替え可能画像)
-- slot (idle/rock/scissors/paper/up/down/left/right) ごとに 1 件。
-- GameAudio / SiteImage と同じく S3 未設定時は data にバイト列を保存し
-- /api/media/character-image/{id} 経由で配信する。
CREATE TABLE "character_images" (
    "id" UUID NOT NULL,
    "slot" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "content_type" TEXT,
    "file_name" TEXT,
    "size_bytes" INTEGER,
    "data" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "character_images_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "character_images_slot_key" ON "character_images"("slot");
