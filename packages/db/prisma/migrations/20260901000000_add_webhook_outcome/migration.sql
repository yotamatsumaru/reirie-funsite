-- =====================================================================
-- Stripe Webhook の処理結果を記録できるようにする
--
-- 【背景 / なぜ必要か】
--   会員から「プレミアムプランに加入したのに無料プランのまま。購入履歴には
--   支払い成功と出ている」という申告が発生した。
--
--   原因は、このサイトのプラン判定が Stripe の入金ではなく DB の
--   subscriptions テーブルだけを見ている構造にある。
--
--     credentials.ts: plan = user.subscriptions[0] ? planType : 'FREE'
--
--   Webhook (customer.subscription.created) がユーザーを特定できないと
--   handleSubscriptionUpsert が { ok: false, reason: 'user_not_found' } を返す。
--   ところが従来の実装は
--     - Stripe には 200 を返す（＝Stripe は再送しない）
--     - 失敗理由は console.warn に出るだけ
--     - stripe_webhook_events には payload しか保存しない
--   となっており、**取りこぼしの記録がどこにも残らなかった**。
--   結果として、会員が問い合わせてくるまで運営は誰も気づけなかった。
--
-- 【この変更】
--   処理結果 (outcome) と、スキップ理由 (skip_reason)、照合用の
--   stripe_customer_id を記録できるようにする。
--   これにより「取りこぼしたイベント」を管理画面から一覧でき、
--   会員の申告を待たずに運営側から復旧できる。
--
-- 【既存行の扱い】
--   過去に記録済みの行は結果が不明なため NULL のままとする。
--   NOT NULL + DEFAULT 'SUCCESS' にしてしまうと、実際には取りこぼして
--   いたイベントまで「成功した」と嘘の記録になり、調査を誤らせる。
--   そのため意図的に NULL 許容とする。
-- =====================================================================

ALTER TABLE "stripe_webhook_events" ADD COLUMN IF NOT EXISTS "outcome" TEXT;
ALTER TABLE "stripe_webhook_events" ADD COLUMN IF NOT EXISTS "skip_reason" TEXT;
ALTER TABLE "stripe_webhook_events" ADD COLUMN IF NOT EXISTS "stripe_customer_id" TEXT;

-- 取りこぼし (outcome = 'SKIPPED') を新しい順に引くためのインデックス
CREATE INDEX IF NOT EXISTS "stripe_webhook_events_outcome_processed_at_idx"
  ON "stripe_webhook_events" ("outcome", "processed_at");
