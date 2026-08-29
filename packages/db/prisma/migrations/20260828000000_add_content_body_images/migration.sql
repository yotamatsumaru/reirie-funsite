-- ブログ記事・ギャラリー本文に挿入する画像の保存先を追加する。
--
-- 背景:
--   本文画像は従来 POST /api/admin/uploads/image を使う想定だったが、
--   そのエンドポイントは requireCapability('MERCH') = 物販権限を要求しており、
--   記事担当者 (CONTENT 権限) が本文に画像を入れると 403 になっていた。
--   さらに S3 未設定環境では unprocessable で即失敗し、
--   商品画像・サイト画像・動画サムネイルには存在する DB フォールバックが
--   本文画像だけ無いという不揃いな状態だった。
--
-- 保存方針 (site_images / product_images / video_thumbnails と同じ二段構え):
--   1. S3 アセットバケット設定済み → S3 へ PUT し url は外部 URL、data は NULL
--   2. 未設定 → data にバイト列を保存し url は /api/media/content-body-image/{id}
--
-- contents との外部キーを張っていない理由:
--   記事を書き始める前 (Content レコードがまだ無い段階) でも本文に画像を
--   挿し込めるようにするため。代わりに uploaded_by と created_at を持たせ、
--   後から「いつ誰が上げた画像か」を棚卸しできるようにしている。
CREATE TABLE "content_body_images" (
  "id" UUID NOT NULL,
  "url" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "file_name" TEXT,
  "size_bytes" INTEGER NOT NULL,
  "data" BYTEA,
  "uploaded_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "content_body_images_pkey" PRIMARY KEY ("id")
);

-- 一覧・棚卸しは新しい順に見るため。
CREATE INDEX "content_body_images_created_at_idx" ON "content_body_images"("created_at");

-- 管理者を削除しても、その人が上げた画像は記事本文から参照され続けるので
-- 画像自体は消さず、アップロード者だけ NULL にする。
ALTER TABLE "content_body_images"
  ADD CONSTRAINT "content_body_images_uploaded_by_fkey"
  FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
