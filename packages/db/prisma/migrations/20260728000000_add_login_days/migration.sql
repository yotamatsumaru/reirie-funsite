-- CreateTable: 実ログイン日の記録 (JST "YYYY-MM-DD" で 1 日 1 行)
CREATE TABLE "login_days" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "login_days_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "login_days_user_id_date_key" ON "login_days"("user_id", "date");
CREATE INDEX "login_days_user_id_date_idx" ON "login_days"("user_id", "date");

-- AddForeignKey
ALTER TABLE "login_days" ADD CONSTRAINT "login_days_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill 1: 既存のログインボーナス受領記録 (login_bonus_grants) を実ログイン日として取り込む。
-- 受領記録は「その日にログインした」ことを意味するため、過去のログイン日数を維持できる。
INSERT INTO "login_days" ("id", "user_id", "date", "created_at")
SELECT gen_random_uuid(), g."user_id", g."date", g."granted_at"
FROM "login_bonus_grants" g
ON CONFLICT ("user_id", "date") DO NOTHING;

-- Backfill 2: 最終ログイン日時 (last_login_at) がある既存ユーザーについて、その日の
-- ログイン日を最低 1 件は記録しておく (ボーナス未受取でも最終ログイン日はカウントする)。
-- JST (UTC+9) に変換した日付キーを使う。
INSERT INTO "login_days" ("id", "user_id", "date", "created_at")
SELECT gen_random_uuid(), u."id",
       to_char(u."last_login_at" AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD'),
       u."last_login_at"
FROM "users" u
WHERE u."last_login_at" IS NOT NULL
ON CONFLICT ("user_id", "date") DO NOTHING;
