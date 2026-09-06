-- ギャラリーの «アルバム» 分けと、限定公開画像の配信制御のための変更。
--
-- 【1. contents.album】
-- 会員様から「ギャラリーをアルバムみたいに分けたい」というご要望をいただいた。
--
-- 専用テーブル (albums) を作らなかった理由:
--   - アルバムの括り方は運用で変わる (ライブ単位 / 月単位 / 衣装単位)。
--     テーブルにすると名前の変更や並べ替えのたびに管理画面が必要になる。
--   - 表紙画像や説明文といった «アルバム自身の属性» は今回の要望に無く、
--     先に作っても使われないカラムを抱えることになる。
-- 将来 albums テーブルが必要になった場合も、この列の値を初期データとして
-- 移行できるので、後戻りできない選択ではない。
--
-- NULL 許容で追加する。既存行に機械的な値を入れない理由は、
-- 「未設定」と「運営が意図して付けたアルバム名」を区別できなくなるため。
-- 一覧では NULL / 空文字をまとめて「その他」として扱う。

ALTER TABLE "contents"
  ADD COLUMN IF NOT EXISTS "album" TEXT;

-- /gallery?album=... の絞り込み用。type と組で引くので複合インデックスにする。
CREATE INDEX IF NOT EXISTS "contents_type_album_idx"
  ON "contents" ("type", "album");

-- 【2. content_images.url のインデックス】
--
-- 画像配信エンドポイント (/api/media/content-body-image/[id]) に
-- 公開範囲のチェックを入れる。そのために「この画像はどのコンテンツのものか」を
-- url の完全一致で逆引きする必要があり、画像 1 枚ごとに毎回引かれる。
-- インデックスが無いと写真が増えるほど表示が重くなるため付けておく。
CREATE INDEX IF NOT EXISTS "content_images_url_idx"
  ON "content_images" ("url");
