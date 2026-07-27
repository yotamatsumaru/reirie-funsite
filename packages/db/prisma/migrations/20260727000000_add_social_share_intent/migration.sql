-- SNS シェア意図 (SocialShareIntent) の追加 (2026-07)
--
-- 目的: 「シェアせずに受取ボタンだけ押して Pui を得る」不正を防ぐため、
--   実際にシェアボタンを開いた記録 (social_share_intents) を必須とし、
--   Pui 付与 (social_share_grants の作成) の前提条件にする。
--
-- 新規テーブル `social_share_intents` の追加のみ。既存テーブルへの
-- 破壊的変更を含まないため安全に適用できる。
--
-- 対応する schema.prisma の変更:
--   model SocialShareIntent (新規)
--   User.socialShareIntents (逆リレーション・DB 影響なし)

-- CreateTable
CREATE TABLE "social_share_intents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_share_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_share_intents_user_id_date_idx" ON "social_share_intents"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "social_share_intents_user_id_date_platform_key" ON "social_share_intents"("user_id", "date", "platform");

-- AddForeignKey
ALTER TABLE "social_share_intents" ADD CONSTRAINT "social_share_intents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
