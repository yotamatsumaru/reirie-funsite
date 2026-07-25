-- お問い合わせテーブルの追加 (2026-07)
--
-- 新規テーブル `contact_messages` と enum `ContactStatus` / `ContactCategory` の追加のみ。
-- 既存テーブルへの破壊的変更を含まないため安全に適用できる。
--
-- 対応する schema.prisma の変更:
--   enum ContactStatus (新規)
--   enum ContactCategory (新規)
--   model ContactMessage (新規)
--   User.contactMessages (逆リレーション・DB 影響なし)

-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ContactCategory" AS ENUM ('GENERAL', 'ACCOUNT', 'BILLING', 'SHIPPING', 'BUG', 'OTHER');

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "category" "ContactCategory" NOT NULL DEFAULT 'GENERAL',
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "ContactStatus" NOT NULL DEFAULT 'NEW',
    "admin_note" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_messages_status_created_at_idx" ON "contact_messages"("status", "created_at");

-- CreateIndex
CREATE INDEX "contact_messages_email_idx" ON "contact_messages"("email");

-- AddForeignKey
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
