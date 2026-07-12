-- お知らせ配信 (サイト内表示 + 一斉メール送信)
CREATE TYPE "AnnouncementAudience" AS ENUM ('ALL', 'MEMBERS', 'PREMIUM');
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "AnnouncementEmailStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'SENDING', 'COMPLETED', 'FAILED');

CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "AnnouncementAudience" NOT NULL DEFAULT 'ALL',
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "send_email" BOOLEAN NOT NULL DEFAULT false,
    "email_status" "AnnouncementEmailStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "email_recipient_count" INTEGER,
    "email_sent_count" INTEGER,
    "email_failed_count" INTEGER,
    "email_started_at" TIMESTAMP(3),
    "email_completed_at" TIMESTAMP(3),
    "email_error" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "author_id" UUID,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "announcements_status_published_at_idx" ON "announcements"("status", "published_at");
CREATE INDEX "announcements_email_status_idx" ON "announcements"("email_status");

ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
