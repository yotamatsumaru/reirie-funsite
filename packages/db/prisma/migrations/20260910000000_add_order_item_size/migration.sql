-- 注文明細にサイズ・カラーのスナップショットを追加する
--
-- 【背景】
-- ProductVariant は optionSize / optionColor を持っていたが、注文時に
-- variantName しか保存していなかった。そのため
--   「ロゴTシャツ ホワイト の L」を注文 → 明細には「ホワイト」だけ
-- となり、どのサイズが注文されたのか分からなかった。
--
-- 既存の注文を壊さないよう NULL 許容で追加する
-- (過去分は後続の UPDATE で可能な範囲を補完する)。
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "option_size"  TEXT;
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "option_color" TEXT;

-- 既存の注文明細は、バリエーションが残っていればそこから補完する。
-- (商品マスタが削除済みの場合は NULL のまま = 補完不能)
UPDATE "order_items" oi
SET "option_size"  = pv."option_size",
    "option_color" = pv."option_color"
FROM "product_variants" pv
WHERE oi."variant_id" = pv."id"
  AND oi."option_size" IS NULL
  AND oi."option_color" IS NULL;
