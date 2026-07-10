-- 新規登録時にメールで送る「認証コード(6桁)」方式を追加。
-- 既存の verification_token (リンク方式) は後方互換のため残す。
ALTER TABLE "users" ADD COLUMN "verification_code" TEXT;
ALTER TABLE "users" ADD COLUMN "verification_code_expires" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "verification_attempts" INTEGER NOT NULL DEFAULT 0;
