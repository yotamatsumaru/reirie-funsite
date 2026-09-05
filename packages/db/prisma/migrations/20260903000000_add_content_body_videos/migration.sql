-- ブログ記事本文に挿入する「短い動画」の保存先を追加する。
--
-- 背景:
--   本文に貼れるのは画像だけで、動画を入れたい場合は VOD (videos) に
--   アップロードして記事から誘導するしかなかった。しかし数秒のクリップに対して
--   VOD は重すぎる。
--
-- videos を再利用しない理由:
--   1. videos は MediaConvert による HLS エンコードのパイプラインに乗るため、
--      status=UPLOADING → READY になるまで記事に貼れない。
--      「書きながらその場で貼る」という用途に対して待ちが長すぎる。
--   2. videos は access_level / is_published / published_at / expires_at を
--      動画自身が持ち、動画一覧 (/me/videos) にも並ぶ。本文クリップは
--      記事の一部であって単独のコンテンツではないので、一覧に出ると邪魔になる。
--   3. videos を削除すると記事本文の <video> が壊れるが、
--      その依存関係を追う仕組みが無い。
--
-- 保存方針 (content_body_images と全く同じ二段構え):
--   1. S3 アセットバケット設定済み → S3 へ PUT し url は外部 URL、data は NULL
--   2. 未設定 → data にバイト列を保存し url は /api/media/content-body-video/{id}
--
-- contents との外部キーを張っていないのは content_body_images と同じ理由で、
-- Content レコードがまだ無い段階 (新規作成中) でも本文に動画を挿せるようにするため。
CREATE TABLE "content_body_videos" (
  "id" UUID NOT NULL,
  "url" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "file_name" TEXT,
  "size_bytes" INTEGER NOT NULL,
  -- 再生前に表示するポスター画像。無いと <video> が真っ黒の矩形として並ぶ。
  "poster_url" TEXT,
  -- ブラウザ側で測った尺。メタデータが壊れた動画では測れないので NULL 可。
  "duration_seconds" INTEGER,
  "data" BYTEA,
  "uploaded_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "content_body_videos_pkey" PRIMARY KEY ("id")
);

-- 一覧・棚卸しは新しい順に見るため。
CREATE INDEX "content_body_videos_created_at_idx" ON "content_body_videos"("created_at");

-- 管理者を削除しても、その人が上げた動画は記事本文から参照され続けるので
-- 動画自体は消さず、アップロード者だけ NULL にする。
ALTER TABLE "content_body_videos"
  ADD CONSTRAINT "content_body_videos_uploaded_by_fkey"
  FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
