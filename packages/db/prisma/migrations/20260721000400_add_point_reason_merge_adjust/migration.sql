-- AlterEnum
-- 特典ポイント (旧 User.rewardPoints) を Fan ポイント (User.points) に統合する際、
-- 既存ユーザーの残高付け替えを記録するための専用理由。
ALTER TYPE "PointReason" ADD VALUE 'MERGE_ADJUST';
