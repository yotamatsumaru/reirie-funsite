-- AlterEnum
-- ミニゲーム (あっち向いてホイ) の勝利で少量の特典ポイントを付与できるようにする。
ALTER TYPE "RewardPointReason" ADD VALUE 'GAME_REWARD';
