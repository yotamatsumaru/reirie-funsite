-- CreateTable: お問い合わせへの運営返信
CREATE TABLE "contact_replies" (
    "id" UUID NOT NULL,
    "contact_message_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "replied_by_id" UUID,
    "email_sent" BOOLEAN NOT NULL DEFAULT false,
    "email_error" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contact_replies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "contact_replies_contact_message_id_created_at_idx" ON "contact_replies"("contact_message_id", "created_at");

-- AddForeignKey
ALTER TABLE "contact_replies" ADD CONSTRAINT "contact_replies_contact_message_id_fkey" FOREIGN KEY ("contact_message_id") REFERENCES "contact_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_replies" ADD CONSTRAINT "contact_replies_replied_by_id_fkey" FOREIGN KEY ("replied_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
