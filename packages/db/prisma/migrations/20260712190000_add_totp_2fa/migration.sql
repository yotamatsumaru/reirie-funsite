-- TOTP (Google Authenticator 等) による2段階認証 (SUPER_ADMIN 限定機能)
-- - totp_secret: AES-256-GCM で暗号化した Base32 シークレット (平文では保存しない)
-- - totp_enabled: セットアップ完了 (初回コード確認済み) フラグ
-- - totp_verified_at: 直近でコード確認に成功した日時 (セットアップ完了日時としても利用)
-- - totp_backup_codes: ワンタイムリカバリコード (scrypt ハッシュ済み) の配列。使用ごとに1件ずつ取り除く

ALTER TABLE "users" ADD COLUMN "totp_secret" TEXT;
ALTER TABLE "users" ADD COLUMN "totp_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "totp_verified_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "totp_backup_codes" TEXT[] DEFAULT ARRAY[]::TEXT[];
