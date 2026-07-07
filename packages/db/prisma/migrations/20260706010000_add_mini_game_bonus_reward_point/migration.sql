-- AlterTable
-- ミニゲーム (あっち向いてホイ) の勝利時に付与した特典ポイントを記録する列を追加。
-- Fan ポイント (reward_point) とは別枠。薄い還元率 + 1日上限のロジックで points.ts から書き込む。
ALTER TABLE "mini_game_plays" ADD COLUMN "bonus_reward_point" INTEGER NOT NULL DEFAULT 0;
