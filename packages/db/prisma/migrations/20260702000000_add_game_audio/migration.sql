-- CreateTable: ゲーム用音声 (あっち向いてホイのキャラボイス等)
-- slot ごとに 1 件。ProductImage と同じく S3 未設定時は data にバイト列を保存し
-- /api/media/game-audio/{id} 経由で配信する。
CREATE TABLE "game_audios" (
    "id" UUID NOT NULL,
    "slot" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "content_type" TEXT,
    "file_name" TEXT,
    "size_bytes" INTEGER,
    "data" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "game_audios_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "game_audios_slot_key" ON "game_audios"("slot");
