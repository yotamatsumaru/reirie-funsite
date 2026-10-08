-- EC 機能拡張 (BASE の「送料詳細設定 App」「販売期間」「商品オプション App」相当)
--
-- 1) 配送方法マスタ + 商品への割り当て (サイズによって ネコポス / 宅急便コンパクト / 宅急便 を選べるように)
-- 2) 商品の販売期間 (発売開始日時を設定して複数商品を一斉発売できるように)
-- 3) 商品オプション (宛名付きチェキの「宛名」などを購入時に入力してもらう)
--
-- すべて既存データを壊さない追加のみ (NULL 許容 / DEFAULT 付き)。

-- ---------------------------------------------------------------------
-- 1) 配送方法
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "shipping_methods" (
  "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
  "name"             TEXT         NOT NULL,
  "description"      TEXT,
  "fee"              INTEGER      NOT NULL,
  "is_default"       BOOLEAN      NOT NULL DEFAULT false,
  "is_active"        BOOLEAN      NOT NULL DEFAULT true,
  "sort_order"       INTEGER      NOT NULL DEFAULT 0,
  "b2_invoice_type"  TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shipping_methods_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "shipping_methods_is_active_sort_order_idx"
  ON "shipping_methods" ("is_active", "sort_order");

CREATE TABLE IF NOT EXISTS "product_shipping_methods" (
  "product_id"          UUID NOT NULL,
  "shipping_method_id"  UUID NOT NULL,
  CONSTRAINT "product_shipping_methods_pkey" PRIMARY KEY ("product_id", "shipping_method_id"),
  CONSTRAINT "product_shipping_methods_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "product_shipping_methods_shipping_method_id_fkey"
    FOREIGN KEY ("shipping_method_id") REFERENCES "shipping_methods" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "product_shipping_methods_shipping_method_id_idx"
  ON "product_shipping_methods" ("shipping_method_id");

-- 注文に「選ばれた配送方法」を残す (マスタ参照 + 名前のスナップショット)
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipping_method_id"   UUID;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shipping_method_name" TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_shipping_method_id_fkey'
  ) THEN
    ALTER TABLE "orders"
      ADD CONSTRAINT "orders_shipping_method_id_fkey"
      FOREIGN KEY ("shipping_method_id") REFERENCES "shipping_methods" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 初期データ: 従来の一律送料 (600円) を「基本配送」として登録しておく。
-- これにより、配送方法が未設定の既存商品も従来どおりの送料で購入できる。
INSERT INTO "shipping_methods" ("id", "name", "description", "fee", "is_default", "is_active", "sort_order", "b2_invoice_type", "updated_at")
SELECT gen_random_uuid(), 'ヤマト宅急便', '全国一律送料', 600, true, true, 0, '0', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "shipping_methods");

-- ---------------------------------------------------------------------
-- 2) 販売期間
-- ---------------------------------------------------------------------
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sale_starts_at" TIMESTAMP(3);
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sale_ends_at"   TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "products_sale_starts_at_idx" ON "products" ("sale_starts_at");

-- ---------------------------------------------------------------------
-- 3) 商品オプション
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "product_options" (
  "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
  "product_id"   UUID         NOT NULL,
  "name"         TEXT         NOT NULL,
  "help_text"    TEXT,
  "max_length"   INTEGER      NOT NULL DEFAULT 20,
  "price"        INTEGER      NOT NULL DEFAULT 0,
  "is_required"  BOOLEAN      NOT NULL DEFAULT true,
  "sort_order"   INTEGER      NOT NULL DEFAULT 0,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_options_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_options_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "product_options_product_id_sort_order_idx"
  ON "product_options" ("product_id", "sort_order");

-- カート明細: オプション入力値 + 一意キー (宛名違いを別行にする)
ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "option_values" JSONB;
ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "options_key"   TEXT NOT NULL DEFAULT '';
-- 旧 unique (cart_id, variant_id) → 新 unique (cart_id, variant_id, options_key)
ALTER TABLE "cart_items" DROP CONSTRAINT IF EXISTS "cart_items_cart_id_variant_id_key";
DROP INDEX IF EXISTS "cart_items_cart_id_variant_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "cart_items_cart_id_variant_id_options_key_key"
  ON "cart_items" ("cart_id", "variant_id", "options_key");

-- 注文明細: オプション入力値のスナップショット
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "option_values" JSONB;
