-- AlterEnum
-- Fan ポイント/特典ポイント統合の一環。PostgreSQL 11 以前では複数の enum 値追加を
-- 単一トランザクション/マイグレーションに含められないため、既存の慣例に合わせて
-- 1 値ずつ個別のマイグレーションに分割する。
ALTER TYPE "PointReason" ADD VALUE 'STRIPE_PURCHASE';
