-- 動画の視聴計測 (再生時間 / 再生位置 / 完視聴) を記録できるようにする。
--
-- 【背景】
-- video_view_logs には watched_ms 列が最初から存在していたが、
-- 書き込む場所が一箇所も無く常に 0 のままだった。
-- 行が作られるのは /api/videos/[id]/playback を叩いた瞬間 (= 再生ボタンを
-- 押した瞬間) だけなので、記録されていたのは実質「再生開始回数」であり、
--   - 3 秒で離脱した人も 1 回
--   - 最後まで見た人も 1 回
--   - 同じ人がページを読み込み直すたびに +1
-- と数えていた。「どれくらい見られたか」を判断する材料が無かった。
--
-- 【方針: 視聴 1 回 = 1 行を更新していく】
-- 再生開始時に作った行を、再生中に定期送信される進捗で UPDATE する。
-- 進捗ごとに行を増やさないのは、15 秒間隔で INSERT すると 1 時間の動画で
-- 240 行になり「行数 = 視聴回数」という既存の意味が壊れるため
-- (管理画面の視聴回数表示が 240 倍になってしまう)。
--
-- 【3 つの数値を分けて持つ理由】
--   watched_ms        … 実際に再生された時間の累計。合計視聴時間の集計用。
--   last_position_ms  … 最後の再生位置。離脱ポイントと続き再生用。
--   completed         … 実質的に最後まで見たか。完視聴率の集計用。
--
-- watched_ms と last_position_ms を分けるのは、巻き戻して見直した場合に
-- 「位置は戻るが視聴時間は増える」ため。位置だけを見ると見直した人の
-- 視聴時間を過小評価し、視聴時間だけを見ると離脱ポイントが分からない。
--
-- completed を保存する (毎回 videos.duration_seconds と突き合わせて
-- 計算しない) のは、動画の尺は再エンコードで後から変わり得るため、
-- 判定した時点の結果を残す方が過去の集計が安定するため。
--
-- 【既存行の扱い】
-- 追加列はすべて DEFAULT 付きなので、既存行は
-- watched_ms=0 / last_position_ms=0 / completed=false / last_active_at=NULL
-- となる。これは「再生開始は記録されているが視聴時間は不明」を正しく表す
-- (計測開始前のデータなので、0 分視聴として集計されるのが正しい)。
-- last_active_at だけ NULL 許容にしているのは、0 や created_at を入れると
-- 「進捗が 1 度も届いていない」ことと区別できなくなるため。

ALTER TABLE "video_view_logs"
  ADD COLUMN IF NOT EXISTS "last_position_ms" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "completed"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "last_active_at"   TIMESTAMP(3);

-- 「この会員がこの動画をどこまで見たか」を引くための索引。
-- 進捗更新のたびに直近の視聴行を特定する必要があり、
-- 既存の (video_id, created_at) / (user_id, created_at) では
-- 会員と動画の組み合わせで絞れず全走査になる。
CREATE INDEX IF NOT EXISTS "video_view_logs_user_id_video_id_idx"
  ON "video_view_logs" ("user_id", "video_id");
