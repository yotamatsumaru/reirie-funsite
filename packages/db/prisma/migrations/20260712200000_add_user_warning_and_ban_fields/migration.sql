-- ユーザー管理機能拡張 (Super Admin)
--  - users.last_login_at : ログイン成功のたびに更新する最終ログイン日時
--    (Auth.js は session strategy=jwt のためログイン時にDB書き込みが発生せず、
--     この列がなければ「最終ログイン」を判定する手段がないため追加)
--  - users.banned_at / users.ban_reason : 運営 (SUPER_ADMIN) による BAN の日時・理由。
--    deletedAt は自己都合の退会でも共用される既存フィールドのため、
--    「運営が BAN した」ことを区別して記録するために追加する。
--    復元 (BAN解除) 時もこの2列は履歴として保持しクリアしない。
--  - user_warnings テーブル: 運営からファンへの警告通知 (メール送信のみ、履歴として全件保持)

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "ban_reason" TEXT,
ADD COLUMN     "banned_at" TIMESTAMP(3),
ADD COLUMN     "last_login_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "user_warnings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "issued_by_id" UUID NOT NULL,
    "email_sent" BOOLEAN NOT NULL DEFAULT false,
    "email_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_warnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_warnings_user_id_created_at_idx" ON "user_warnings"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "user_warnings" ADD CONSTRAINT "user_warnings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_warnings" ADD CONSTRAINT "user_warnings_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
