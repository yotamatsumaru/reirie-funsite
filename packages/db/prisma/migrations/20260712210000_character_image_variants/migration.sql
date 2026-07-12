-- あっち向いてホイのキャラクター画像を「1ポーズ最大3パターン」対応にする。
-- 従来は slot ごとに 1 件 (slot @unique) だったが、variant (1〜3) 列を追加し、
-- (slot, variant) の複合ユニークに変更する。ゲーム表示時はポーズ内の
-- 登録済みパターンからランダムに 1 枚選択される。

-- 1) variant 列を追加 (既存行はすべて variant=1 とみなす)
ALTER TABLE "character_images" ADD COLUMN "variant" INTEGER NOT NULL DEFAULT 1;

-- 2) 旧 slot 単独ユニークインデックスを削除
DROP INDEX IF EXISTS "character_images_slot_key";

-- 3) (slot, variant) の複合ユニークインデックスを作成
CREATE UNIQUE INDEX "character_images_slot_variant_key" ON "character_images"("slot", "variant");
