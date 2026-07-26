-- 誕生日メール機能の追加 (2026-07)
--
-- 新規テーブル `birthday_mail_templates` (年ごとのメール内容) と
-- `birthday_mail_deliveries` (会員×年ごとの配信記録) の追加のみ。
-- 既存テーブルへの破壊的変更を含まないため安全に適用できる。
--
-- 対応する schema.prisma の変更:
--   model BirthdayMailTemplate (新規)
--   model BirthdayMailDelivery (新規)
--   User.birthdayMailDeliveries (逆リレーション・DB 影響なし)

-- CreateTable
CREATE TABLE "birthday_mail_templates" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "image_url" TEXT,
    "image_content_type" TEXT,
    "image_file_name" TEXT,
    "image_size_bytes" INTEGER,
    "image_data" BYTEA,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "birthday_mail_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "birthday_mail_deliveries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "template_id" UUID,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "image_url" TEXT,
    "email_sent" BOOLEAN NOT NULL DEFAULT false,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "birthday_mail_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "birthday_mail_templates_year_key" ON "birthday_mail_templates"("year");

-- CreateIndex
CREATE UNIQUE INDEX "birthday_mail_deliveries_user_id_year_key" ON "birthday_mail_deliveries"("user_id", "year");

-- CreateIndex
CREATE INDEX "birthday_mail_deliveries_year_sent_at_idx" ON "birthday_mail_deliveries"("year", "sent_at");

-- AddForeignKey
ALTER TABLE "birthday_mail_deliveries" ADD CONSTRAINT "birthday_mail_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "birthday_mail_deliveries" ADD CONSTRAINT "birthday_mail_deliveries_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "birthday_mail_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
