-- お問い合わせの「控えメール」機能で使う列を追加する。
--
-- 【背景】
-- 会員様から「お問い合わせした内容のコピーをメールで送ってほしい。
-- 届いているのか分からない」というご要望をいただいた。
-- また、ある問い合わせが 2 週間気づかれなかった事例があり、
-- その原因は「新規問い合わせが届いても運営に通知が飛ばない」ことだった。
-- そこで (1) 送信者への控えメール (2) 運営への受信通知 の 2 系統を追加し、
-- それぞれの送信結果を DB に記録できるようにする。
--
-- 【既存行の扱い — なぜバックフィルしないのか】
-- ticket_number は NULL 許容のまま追加し、既存行には番号を振らない。
-- 機械的に番号を振ると「番号は存在するが控えメールは送っていない」行が生まれ、
-- 会員が番号を問い合わせてきたときに運営が照合できず混乱する。
-- 「番号なし = この機能より前の問い合わせ」と読めるほうが運用上安全なため、
-- 既存行は NULL のまま残す (管理画面では「—」と表示する)。
--
-- ack_mail_sent は NOT NULL DEFAULT false。既存行が false になるのは
-- 「実際に控えメールを送っていない」という事実と一致するため正しい。

ALTER TABLE "contact_messages"
  ADD COLUMN IF NOT EXISTS "ticket_number" TEXT,
  ADD COLUMN IF NOT EXISTS "ack_mail_sent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "ack_mail_sent_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "ack_mail_error" TEXT,
  ADD COLUMN IF NOT EXISTS "admin_notified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "admin_notify_error" TEXT;

-- 受付番号は一意。NULL は複数行あってよい (Postgres の UNIQUE は NULL を重複と見なさない)
-- ため、既存行を NULL のまま残せる。
CREATE UNIQUE INDEX IF NOT EXISTS "contact_messages_ticket_number_key"
  ON "contact_messages" ("ticket_number");
