-- 登録メールアドレスの変更フロー (保留状態) 用のカラムを追加する。
--
-- 背景:
--   これまで会員が登録メールアドレスを変更する手段が一切なく、
--   「登録のメールアドレス変えたい」という問い合わせを運営が
--   手作業で受けるしかなかった。しかも運営側にも変更用の画面が無かった。
--
-- なぜ email を直接更新せず「保留」を挟むのか:
--   このサイトではメールアドレスがログイン ID そのものであり、
--   パスワードリセットの送信先でもある。打ち間違えたアドレスで確定すると
--   本人が二度とログインできず、自力での復旧も不可能になる。
--   そこで新アドレス宛に確認コードを送り、入力に成功した時点で初めて
--   users.email へ昇格させる。それまでの間の退避先がこれらのカラム。
--
-- pending_email に UNIQUE を付けない理由:
--   保留中は「まだ本人のものと確認できていない」状態にすぎない。
--   ここに一意制約を付けると、第三者が他人のアドレスを保留に入れるだけで
--   そのアドレスの持ち主が変更申請できなくなる (妨害が成立してしまう)。
--   実際の重複防止は、確定時に users.email の既存 UNIQUE (citext) で行う。
--
-- citext を使う理由:
--   users.email が citext (大文字小文字を区別しない) のため、保留側も
--   同じ型にしておかないと「確定できる/できない」の判定が食い違う。
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pending_email" CITEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pending_email_code" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pending_email_expires" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pending_email_attempts" INTEGER NOT NULL DEFAULT 0;

-- 期限切れの保留を定期的に掃除する際に使う (件数が増えても軽量に走査できるようにする)。
CREATE INDEX IF NOT EXISTS "users_pending_email_expires_idx"
  ON "users" ("pending_email_expires")
  WHERE "pending_email" IS NOT NULL;
