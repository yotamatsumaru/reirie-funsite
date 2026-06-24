-- CreateEnum
CREATE TYPE "PointReason" AS ENUM ('LOGIN_BONUS', 'LOGIN_STREAK', 'SOCIAL_SHARE', 'ADMIN_ADJUST', 'SIGNUP_BONUS', 'OTHER');

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('X', 'INSTAGRAM');

-- AlterTable: 会員番号 & ポイント残高
ALTER TABLE "users" ADD COLUMN     "member_number" TEXT;
ALTER TABLE "users" ADD COLUMN     "points" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "users_member_number_key" ON "users"("member_number");

-- CreateTable: 会員番号採番カウンター
CREATE TABLE "member_counter" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "next" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "member_counter_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ポイント取引履歴
CREATE TABLE "point_transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "reason" "PointReason" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "point_transactions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "point_transactions_user_id_created_at_idx" ON "point_transactions"("user_id", "created_at");

-- CreateTable: ログインボーナス受領記録
CREATE TABLE "login_bonus_grants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "streak" INTEGER NOT NULL DEFAULT 1,
    "amount" INTEGER NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "login_bonus_grants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "login_bonus_grants_user_id_date_key" ON "login_bonus_grants"("user_id", "date");
CREATE INDEX "login_bonus_grants_user_id_date_idx" ON "login_bonus_grants"("user_id", "date");

-- CreateTable: SNS シェア付与記録
CREATE TABLE "social_share_grants" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "amount" INTEGER NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "social_share_grants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "social_share_grants_user_id_date_platform_key" ON "social_share_grants"("user_id", "date", "platform");
CREATE INDEX "social_share_grants_user_id_date_idx" ON "social_share_grants"("user_id", "date");

-- CreateTable: 永続アプリ設定
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- AddForeignKey
ALTER TABLE "point_transactions" ADD CONSTRAINT "point_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "login_bonus_grants" ADD CONSTRAINT "login_bonus_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_share_grants" ADD CONSTRAINT "social_share_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
