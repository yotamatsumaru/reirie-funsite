-- DropForeignKey
ALTER TABLE "reward_point_transactions" DROP CONSTRAINT "reward_point_transactions_user_id_fkey";

-- DropTable
-- 特典ポイント統合 (2026-07)。旧 RewardPointTransaction モデルは廃止し、
-- 台帳は PointTransaction (reason に STRIPE_PURCHASE / SUBSCRIPTION_BONUS /
-- REDEMPTION / REFUND / MERGE_ADJUST 等を追加) に一本化する。
-- データは 20260721001000_merge_reward_points_into_points で users.points への
-- 合算と MERGE_ADJUST 台帳エントリの記録が完了済みであること。
DROP TABLE "reward_point_transactions";

-- DropEnum
DROP TYPE "RewardPointReason";

-- AlterTable
-- users.reward_points は Fan ポイント (users.points) に統合済みのため削除する。
ALTER TABLE "users" DROP COLUMN "reward_points";

-- AlterTable
-- ミニゲーム勝利時の特典ポイントボーナス機構は廃止 (Fan ポイントの勝利報酬額を
-- 引き上げて代替) されたため、記録用カラムを削除する。
ALTER TABLE "mini_game_plays" DROP COLUMN "bonus_reward_point";
