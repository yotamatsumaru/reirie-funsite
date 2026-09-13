-- サブスク分析ダッシュボード (/super-admin/subscriptions) の高速化
--
-- 【背景】
-- これまで当該ページは subscriptions テーブルを無条件・無制限に
-- findMany() で全件取得し、KPI集計・12ヶ月推移・下部一覧のフィルタリングを
-- すべて Node.js 側のメモリ上で行っていた。契約数が増えるほどページの
-- 表示が線形に重くなる問題があったため、集計を DB 側 (groupBy / 生SQL) に
-- 寄せる形にリファクタリングした。
--
-- このマイグレーションでは、その集計クエリが使う createdAt / canceledAt の
-- 範囲検索・月次グルーピングを高速化するためのインデックスを追加する。
-- 新規カラム・テーブルの追加は無く、既存データへの影響もない。
CREATE INDEX IF NOT EXISTS "subscriptions_created_at_idx"
  ON "subscriptions" ("created_at");

CREATE INDEX IF NOT EXISTS "subscriptions_canceled_at_idx"
  ON "subscriptions" ("canceled_at");

-- 契約一覧の各行が「返金済みかどうか」を判定するため、
-- payments.subscription_id で IN 検索する頻度が増えるためのインデックス。
CREATE INDEX IF NOT EXISTS "payments_subscription_id_idx"
  ON "payments" ("subscription_id");
