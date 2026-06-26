-- CreateEnum
CREATE TYPE "MiniGameType" AS ENUM ('ACCHI_MUITE_HOI');

-- CreateEnum
CREATE TYPE "MiniGameResult" AS ENUM ('WIN', 'LOSE', 'DRAW');

-- CreateTable: ミニゲームのプレイ記録
CREATE TABLE "mini_game_plays" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "game_type" "MiniGameType" NOT NULL,
    "date" TEXT NOT NULL,
    "result" "MiniGameResult" NOT NULL,
    "reward_point" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mini_game_plays_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "mini_game_plays_user_id_game_type_date_idx" ON "mini_game_plays"("user_id", "game_type", "date");
CREATE INDEX "mini_game_plays_user_id_created_at_idx" ON "mini_game_plays"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "mini_game_plays" ADD CONSTRAINT "mini_game_plays_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
