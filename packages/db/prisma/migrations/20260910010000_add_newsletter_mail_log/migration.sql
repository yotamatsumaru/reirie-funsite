-- 会報誌メールの送信ログ
--
-- 【なぜ必要か】
-- 会報誌の発送連絡は «実在の会員» への一斉送信なので、二度押しや
-- 押し間違いで同じ号の案内が重複して届くと信用を損なう。
-- (issue_key, kind, user_id) を一意にして二重送信を DB 制約で防ぐ。
--
-- 冪等に書く (再実行しても安全)。
DO $$
BEGIN
  CREATE TYPE "NewsletterMailKind" AS ENUM ('ADDRESS_REMINDER', 'SHIPPING_NOTICE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "newsletter_mail_logs" (
  "id"         UUID NOT NULL,
  "issue_key"  TEXT NOT NULL,
  "kind"       "NewsletterMailKind" NOT NULL,
  "user_id"    UUID NOT NULL,
  "email"      TEXT NOT NULL,
  "sent_at"    TIMESTAMP(3),
  "error"      TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "newsletter_mail_logs_pkey" PRIMARY KEY ("id")
);

-- 同じ号・同じ種別を同じ会員に二重送信しないための制約
CREATE UNIQUE INDEX IF NOT EXISTS "newsletter_mail_logs_issue_kind_user_key"
  ON "newsletter_mail_logs" ("issue_key", "kind", "user_id");

CREATE INDEX IF NOT EXISTS "newsletter_mail_logs_issue_kind_idx"
  ON "newsletter_mail_logs" ("issue_key", "kind");

DO $$
BEGIN
  ALTER TABLE "newsletter_mail_logs"
    ADD CONSTRAINT "newsletter_mail_logs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
