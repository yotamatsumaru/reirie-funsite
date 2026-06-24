-- AlterTable: 画像バイト列を DB に保存できるようにする (S3 未設定時のフォールバック)
ALTER TABLE "product_images" ADD COLUMN     "data" BYTEA;
ALTER TABLE "product_images" ADD COLUMN     "content_type" TEXT;
