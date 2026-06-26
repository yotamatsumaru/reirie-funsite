-- CreateEnum
CREATE TYPE "DirectMessageStatus" AS ENUM ('SENT', 'READ', 'REPLIED');

-- AlterTable: ファンが REIRIE に呼んでほしい名前 (@ メンション用)
ALTER TABLE "users" ADD COLUMN "preferred_name" TEXT;

-- CreateTable: ファン → REIRIE への DM
CREATE TABLE "direct_messages" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "sender_name" TEXT,
    "body" TEXT NOT NULL,
    "status" "DirectMessageStatus" NOT NULL DEFAULT 'SENT',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "direct_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "direct_messages_user_id_created_at_idx" ON "direct_messages"("user_id", "created_at");
CREATE INDEX "direct_messages_status_created_at_idx" ON "direct_messages"("status", "created_at");

-- AddForeignKey
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
