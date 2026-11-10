-- Mero (Pui の上位ポイント) を追加する。
-- 追加のみ (既存データには影響しない)。User.mero は既定 0。
-- 機能自体は site.sectionVisibility.meroVisible (既定 false = 非公開) で隠している。

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "MeroReason" AS ENUM ('ADMIN_ADJUST', 'LIVE_BENEFIT', 'MERCH_BENEFIT', 'REDEMPTION', 'REFUND', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mero" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "mero_transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "reason" "MeroReason" NOT NULL,
    "note" TEXT,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mero_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "mero_transactions_user_id_created_at_idx" ON "mero_transactions"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "mero_transactions_reason_created_at_idx" ON "mero_transactions"("reason", "created_at");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "mero_transactions" ADD CONSTRAINT "mero_transactions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 残高は常に 0 以上 (アプリ側でも検証するが、DB でも二重に守る)
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_mero_non_negative" CHECK ("mero" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
