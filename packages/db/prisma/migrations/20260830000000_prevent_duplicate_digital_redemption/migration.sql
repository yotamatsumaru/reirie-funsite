-- デジタル特典 (壁紙など) の重複交換を DB レベルで禁止する。
--
-- 【背景】
-- これまで「同じデジタル特典を何度でも交換できる」状態だった。
-- デジタル特典は一度交換すれば以後いつでも何度でもダウンロードできるので、
-- 2 回目以降の交換は Pui を払っても新たに得るものがなく、会員の純損失になる。
-- アプリ側 (redeemRewardCatalogItem) でも拒否するが、
-- 「交換ボタンの連打」や複数タブからの同時実行では
-- 「両方が『まだ交換していない』と判定してから、両方が INSERT する」
-- という競合が起こりうる。最後の砦として DB 制約でも防ぐ。
--
-- 【なぜ部分ユニークインデックスなのか】
--   * DIGITAL 以外 (GOODS / CALL_PRIORITY) は複数回の交換が正当なので対象外にする
--     ("同じグッズを 2 個ほしい" "次回の特典会でも優先枠を取りたい" は正しい要求)
--   * CANCELED (運営がキャンセルし Pui を返還済み) は対象外にする
--     → でないと一度キャンセルされた会員が二度と交換できず詰んでしまう
-- この 2 つの除外条件があるため、通常の UNIQUE 制約 / Prisma の @@unique では
-- 表現できず、WHERE 句付きの部分ユニークインデックスを使う。
-- (このためインデックスは schema.prisma ではなくこの SQL で定義し、
--  schema.prisma 側にはコメントで存在を明記している)

-- ---------------------------------------------------------------------------
-- STEP 1: 既存の重複データを片付ける
-- ---------------------------------------------------------------------------
-- 重複が 1 件でも残っているとインデックス作成が失敗し、
-- マイグレーション全体が止まってしまう。
-- 「本番には既に重複が存在する」前提で、先に必ず解消しておく。
--
-- 方針: 各 (会員, 景品) について最初の 1 件だけを有効として残し、
--       2 件目以降は CANCELED にして Pui を会員へ返還する。
--       会員は 1 件目で引き続きダウンロードできるので、権利は失われない。
--       誤って引かれた Pui は返るので、会員が損をしない。

-- 2 件目以降 (最初の交換より後に作られたもの) を特定する一時テーブル
CREATE TEMP TABLE _dup_digital_redemptions AS
SELECT id, user_id, item_name, pui_cost
FROM (
  SELECT
    id,
    user_id,
    item_name,
    pui_cost,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, catalog_item_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM reward_redemptions
  WHERE item_kind = 'DIGITAL'
    AND status <> 'CANCELED'
) ranked
WHERE rn > 1;

-- 返還した Pui を会員残高に戻す (会員ごとに合計してから 1 回だけ更新)
UPDATE users u
SET pui = u.pui + d.total_refund
FROM (
  SELECT user_id, SUM(pui_cost) AS total_refund
  FROM _dup_digital_redemptions
  GROUP BY user_id
) d
WHERE u.id = d.user_id
  AND d.total_refund > 0;

-- 返還の取引履歴を残す (残高の変化が履歴から追えるようにする。監査用)
-- balance には返還後の残高を入れる (users.pui は直前の UPDATE で更新済み)。
INSERT INTO pui_transactions (id, user_id, amount, balance, reason, note, created_at)
SELECT
  gen_random_uuid(),
  d.user_id,
  d.pui_cost,
  u.pui,
  'REFUND'::"PuiReason",
  d.item_name || ' の重複交換の返還 (システム修正による自動返還)',
  NOW()
FROM _dup_digital_redemptions d
JOIN users u ON u.id = d.user_id
WHERE d.pui_cost > 0;

-- 重複していた交換レコード自体を CANCELED にする
-- (削除ではなく CANCELED にするのは、何が起きたかを履歴から追えるようにするため)
UPDATE reward_redemptions r
SET status = 'CANCELED',
    canceled_at = NOW(),
    admin_note = COALESCE(r.admin_note || E'\n', '')
      || '[システム] 同じデジタル特典の重複交換を検出したため自動キャンセルし、Pui を返還しました。'
      || '最初の交換は有効なままなので、ダウンロードは引き続き可能です。'
FROM _dup_digital_redemptions d
WHERE r.id = d.id;

DROP TABLE _dup_digital_redemptions;

-- ---------------------------------------------------------------------------
-- STEP 2: 今後の重複を DB で禁止する
-- ---------------------------------------------------------------------------
-- DIGITAL かつ未キャンセルの交換は、(会員, 景品) の組で 1 件までに限定する。
CREATE UNIQUE INDEX "reward_redemptions_unique_active_digital"
  ON "reward_redemptions" ("user_id", "catalog_item_id")
  WHERE "item_kind" = 'DIGITAL' AND "status" <> 'CANCELED';

-- アプリ側の重複チェック (交換前の存在確認) とダウンロード権限の照合を
-- インデックスで引けるようにする。
-- 既存の (user_id, created_at) では catalog_item_id で絞れず、
-- 交換履歴が増えた会員ほど確認が遅くなるため。
CREATE INDEX "reward_redemptions_user_id_catalog_item_id_status_idx"
  ON "reward_redemptions" ("user_id", "catalog_item_id", "status");
