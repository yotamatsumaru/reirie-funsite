-- 動画サムネイルを運営が手動で設定できるようにする。
--
-- 【背景】
-- これまで videos.thumbnail_url はエンコードパイプライン
-- (job-complete / sync) が MediaConvert の出力キーを書き込む専用の列で、
-- 運営が任意の画像を指定する手段が一切なかった。
-- その結果
--   - MediaConvert がサムネイルを出さなかった動画は永久にプレースホルダー
--   - 自動生成されたコマが不適切 (目を閉じている等) でも差し替え不可
-- という状態だった。
--
-- 【方針】
-- 画像の保存先は SiteImage / ProductImage / GameAudio と同じ二段構えにする。
--   1. S3 アセットバケット (S3_ASSET_BUCKET) 設定済み
--        → S3 へ PUT し、videos.thumbnail_url に外部 URL を入れる。
--   2. 未設定
--        → バイト列を video_thumbnails に保存し、
--          videos.thumbnail_url = /api/media/video-thumbnail/<id>?v=<updatedAt>。
-- ローカルディスク保存は standalone build の配信ディレクトリとズレ、
-- 再ビルドで消え、PM2 cluster 間で不整合になるため採用しない。
--
-- thumbnail_url 自体は既存列をそのまま流用する (表示側 6 箇所の読み出しを
-- 変えずに済み、S3 キー / 絶対URL / 内部パスのどれでも解決できるため)。
--
-- 【videos に BYTEA 列を足さなかった理由】
-- 既存コードには select を指定しない `prisma.video.findUnique({ where: { id } })`
-- が 9 箇所以上ある。videos に画像本体を持たせると、一覧表示・再生・
-- 視聴ログのたびに最大 8MB の BYTEA を読み込むことになる。
-- 1:1 の別テーブルに切り出し、配信エンドポイントだけが読むようにする。
CREATE TABLE IF NOT EXISTS "video_thumbnails" (
  "video_id"     UUID         NOT NULL,
  "data"         BYTEA        NOT NULL,
  "content_type" TEXT         NOT NULL,
  "file_name"    TEXT,
  "size_bytes"   INTEGER      NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "video_thumbnails_pkey" PRIMARY KEY ("video_id")
);

-- 動画を削除したらサムネイルも消える (孤児レコードを残さない)。
ALTER TABLE "video_thumbnails"
  DROP CONSTRAINT IF EXISTS "video_thumbnails_video_id_fkey";
ALTER TABLE "video_thumbnails"
  ADD CONSTRAINT "video_thumbnails_video_id_fkey"
  FOREIGN KEY ("video_id") REFERENCES "videos"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
