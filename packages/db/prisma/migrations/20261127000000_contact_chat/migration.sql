-- お問い合わせをチャット形式にする (会員と運営がスレッドでやり取りできるようにする)。
-- 追加のみ。既存の返信はすべて運営からのものなので sender の既定値 ADMIN で正しい。

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ContactSender" AS ENUM ('ADMIN', 'MEMBER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: contact_replies
ALTER TABLE "contact_replies" ADD COLUMN IF NOT EXISTS "sender" "ContactSender" NOT NULL DEFAULT 'ADMIN';
ALTER TABLE "contact_replies" ADD COLUMN IF NOT EXISTS "admin_read_at" TIMESTAMP(3);

-- AlterTable: contact_messages
ALTER TABLE "contact_messages" ADD COLUMN IF NOT EXISTS "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 既存の問い合わせは「最後の返信日時 (無ければ受付日時)」で埋める。
-- (列追加時の既定値 CURRENT_TIMESTAMP のままだと、全件がマイグレーション時刻に並んでしまう)
UPDATE "contact_messages" m
SET "last_message_at" = GREATEST(
  m."created_at",
  COALESCE(
    (SELECT MAX(r."created_at") FROM "contact_replies" r WHERE r."contact_message_id" = m."id"),
    m."created_at"
  )
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contact_messages_last_message_at_idx" ON "contact_messages"("last_message_at");
CREATE INDEX IF NOT EXISTS "contact_messages_user_id_last_message_at_idx" ON "contact_messages"("user_id", "last_message_at");
CREATE INDEX IF NOT EXISTS "contact_replies_contact_message_id_sender_idx" ON "contact_replies"("contact_message_id", "sender");
