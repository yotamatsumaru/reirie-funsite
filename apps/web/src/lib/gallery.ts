/**
 * ギャラリー (ライブ写真などの複数枚まとめ) のロジック (純粋関数のみ)。
 *
 * ## 既存の仕組みを再利用している
 *
 * ギャラリーのために新しいテーブルは作っていない。
 * 以前から以下が存在していたが、**表示画面が無かったため機能していなかった**。
 *
 *   - `ContentType.GALLERY`  … 種別 enum。管理フォームで選べた
 *   - `content_images` テーブル … 1 コンテンツに複数画像を紐づける
 *   - 詳細ページ / API の `include: { images: ... }` … 取得はしていた
 *
 * つまり「画像を取得しているのに一切描画していない」状態だった。
 * さらに管理画面には画像を登録する UI が無く、
 * `imageUrls` を送る手段が実質存在しなかった。
 * この機能は、その欠けていた部分 (登録 UI と表示) を埋めるもの。
 *
 * ## URL の検証を独自に持つ理由 (重要)
 *
 * 共有スキーマ (packages/shared) の `CreateContentSchema.imageUrls` は
 * `z.array(z.url())` で **絶対 URL のみ** を許していた。
 * ところが画像アップロード API (`/api/admin/contents/images`) は
 * S3 未設定の環境では `/api/media/content-body-image/<uuid>` という
 * **相対パス** を返す。
 *
 * 結果として「アップロードは成功するのに、その URL をギャラリーに
 * 登録しようとすると 400 で弾かれる」という状態だった。
 * (S3 を設定している本番では通り、S3 未設定の環境だけ壊れるので
 *  気付きにくい)
 *
 * そこで相対パスも受け付ける検証をここに置く。
 * `javascript:` などのスキームは拒否する必要があるため、
 * 「何でも通す」わけにはいかない。
 */

/** 1 つのギャラリーに登録できる画像の上限。 */
export const GALLERY_IMAGE_MAX = 60;

/**
 * 一覧のサムネイルに使う枚数。
 * カバー画像が無いギャラリーで、最初の数枚をタイル状に見せるために使う。
 */
export const GALLERY_PREVIEW_COUNT = 4;

/**
 * 画像 URL として受け付けるかどうか。
 *
 * 許可する形:
 *   1. `http(s)://…`          … 外部 URL / S3 / CloudFront
 *   2. `/…`                   … 自サーバの配信パス (S3 未設定時のフォールバック)
 *
 * 拒否する形:
 *   - `javascript:` `data:` `vbscript:` などのスキーム
 *     (img src に data: を許すと、巨大な base64 を DB に入れられてしまう。
 *      画像本体は ContentBodyImage 側に保存する設計なので不要)
 *   - `//example.com/a.png` (プロトコル相対)
 *     ページが http のときに意図しないオリジンから読み込む余地を残さない
 *   - 空文字 / 空白のみ
 */
export function isValidGalleryImageUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const v = url.trim();
  if (v.length === 0) return false;

  // プロトコル相対 (//host/path) は拒否。
  // 先頭が '/' の判定より先に見る必要がある。
  if (v.startsWith('//')) return false;

  if (v.startsWith('/')) return true;

  return /^https?:\/\/./i.test(v);
}

/**
 * 送られてきた画像 URL 配列を正規化する。
 *
 *   - 前後の空白を落とす
 *   - 無効な URL を捨てる
 *   - 重複を除く (同じ写真が 2 度並ぶのを防ぐ)
 *   - 上限で切る
 *
 * 「無効な要素があったら全体を 400 にする」ではなく
 * 「使えるものだけ残す」方針にしている。
 * 60 枚アップロードした最後の 1 枚が失敗しただけで
 * 全部やり直しになるのは、運営の手間が大きすぎるため。
 */
export function normalizeGalleryImageUrls(
  input: unknown,
  max: number = GALLERY_IMAGE_MAX,
): string[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of input) {
    if (!isValidGalleryImageUrl(raw)) continue;
    const v = raw.trim();
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= max) break;
  }

  return out;
}

export type GalleryImageLike = { url: string; caption?: string | null };

/**
 * 一覧カードに出す代表画像を決める。
 *
 * ギャラリーは「カバー画像を別途設定していない」ことが多い
 * (写真を並べるのが目的で、代表を選ぶ手間をかけたくない)。
 * その場合は 1 枚目の写真を代表として使う。
 *
 * @returns 代表画像の URL。1 枚も無ければ null。
 */
export function resolveGalleryCover(
  coverImageUrl: string | null | undefined,
  images: GalleryImageLike[] | null | undefined,
): string | null {
  if (typeof coverImageUrl === 'string' && coverImageUrl.trim().length > 0) {
    return coverImageUrl.trim();
  }
  const first = (images ?? []).find((i) => isValidGalleryImageUrl(i.url));
  return first ? first.url.trim() : null;
}

/**
 * 一覧カードのタイル表示に使う画像を取り出す。
 *
 * カバー 1 枚だけを大きく出すより、
 * 「何枚もある」ことが伝わるタイルのほうがギャラリーらしい。
 */
export function galleryPreviewImages(
  images: GalleryImageLike[] | null | undefined,
  count: number = GALLERY_PREVIEW_COUNT,
): string[] {
  return (images ?? [])
    .filter((i) => isValidGalleryImageUrl(i.url))
    .slice(0, count)
    .map((i) => i.url.trim());
}

/**
 * 「他 N 枚」の N を返す。プレビューに出しきれない残り枚数。
 * 0 以下なら null (何も表示しない)。
 */
export function remainingImageCount(
  total: number,
  shown: number = GALLERY_PREVIEW_COUNT,
): number | null {
  const rest = total - shown;
  return rest > 0 ? rest : null;
}

/**
 * ライトボックスの «次 / 前» の添字を返す (端は循環)。
 *
 * 循環させる理由: 写真を見ていて最後まで来たときに
 * 「進めない」より「最初に戻る」ほうが操作が止まらない。
 * 1 枚しか無いときは動かさない。
 */
export function stepIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  if (length === 1) return 0;
  return (((current + delta) % length) + length) % length;
}

/** 画像の枚数表示 (例: "3 / 12")。 */
export function formatImageCounter(index: number, total: number): string {
  if (total <= 0) return '0 / 0';
  const clamped = Math.min(Math.max(index, 0), total - 1);
  return `${clamped + 1} / ${total}`;
}
