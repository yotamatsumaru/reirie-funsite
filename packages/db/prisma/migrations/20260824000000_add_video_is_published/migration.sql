-- 動画単位の公開 / 非公開スイッチを追加する。
--
-- 【背景】
-- これまで動画の可視性は status(READY) と publishedAt だけで決まっていた。
-- しかし status はあくまで「エンコードが完了したか」を表すものなので、
--   「エンコードは終わっているが、まだ会員には見せたくない」
-- という状態を表現できなかった。運営が動画を下げるには status を
-- 手で戻す (= エンコード状態を偽る) しかなく、再エンコード判定など
-- 他の処理と競合する危険があった。
--
-- そこで公開制御専用の独立したフラグを追加する。
--   - status      … エンコードの進行状況 (UPLOADING / PROCESSING / READY / FAILED)
--   - isPublished … 運営が見せる / 見せないを決めるスイッチ
--
-- 一覧・視聴に出るのは is_published = true かつ status = 'READY' のときのみ。
--
-- 既存行は「今まで見えていたものが突然消える」ことがないよう
-- DEFAULT true で埋める (後方互換)。
ALTER TABLE "videos"
  ADD COLUMN IF NOT EXISTS "is_published" BOOLEAN NOT NULL DEFAULT true;

-- 会員向け一覧のクエリ (is_published + status + published_at) 用のインデックス。
CREATE INDEX IF NOT EXISTS "videos_is_published_status_published_at_idx"
  ON "videos" ("is_published", "status", "published_at");
