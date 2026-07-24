-- サブスクリプションの「期間満了時プラン切替予約」機能の追加 (2026-07)
--
-- 追加カラム:
--   subscriptions.scheduled_plan_type : 期間満了時に切り替わる予約プラン (NULL = 予約なし)
--   subscriptions.stripe_schedule_id  : 予約に使用する Stripe Subscription Schedule の ID
--
-- どちらも NULL 許容の追加のみ。既存行・既存機能に破壊的変更はなく安全に適用できる。
--
-- 対応する schema.prisma の変更:
--   model Subscription に scheduledPlanType / stripeScheduleId を追加

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "scheduled_plan_type" "PlanType",
ADD COLUMN     "stripe_schedule_id" TEXT;
