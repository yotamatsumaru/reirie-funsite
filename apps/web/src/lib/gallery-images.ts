/**
 * ギャラリー画像の入力 (URL 配列 + キャプション配列) を
 * DB に入れる形へ組み立てる (純粋関数)。
 *
 * URL の検証・正規化そのものは lib/gallery.ts が担当し、
 * ここは「キャプションを正しい写真に対応づける」責務だけを持つ。
 *
 * ## URL とキャプションを別配列で受け取る理由
 *
 * `[{url, caption}]` のオブジェクト配列で受けるほうが素直だが、
 * 既存の共有スキーマが `imageUrls: string[]` を持っており、
 * これを使っている呼び出し元 (seed / demo-fixtures / 既存の管理 API 契約) を
 * 壊さずにキャプションを足すには、並列の配列を追加するのが最小の変更になる。
 *
 * ## 対応づけの落とし穴
 *
 * `normalizeGalleryImageUrls()` は無効な URL を **捨てる** ため、
 * 正規化後の配列は元の配列と添字がズレる。
 * 正規化後の添字でキャプションを引くと
 * 「3 枚目の写真に 4 枚目のキャプション」が付いてしまう。
 *
 * そこで **元配列を走査し、元の添字でキャプションを引いて**
 * URL → キャプションの対応表を作ってから正規化後の配列に当てる。
 *
 * なお、この対応づけを「有効な URL だけを数えた連番」で書くと
 * 同じズレが再発する (実装中に一度やって、テストが検出した)。
 * 無効な URL の直後から 1 つずれるので、必ず元の添字を使う。
 */
import { normalizeGalleryImageUrls, isValidGalleryImageUrl } from './gallery';

export type GalleryImageInput = {
  url: string;
  /** 未入力なら null (DB の caption は nullable)。 */
  caption: string | null;
};

/**
 * URL 配列とキャプション配列から、DB 登録用の配列を作る。
 *
 * @param urls     画像 URL。無効なものは捨てられる。
 * @param captions urls と同じ順序のキャプション。長さが違っても落ちない。
 */
export function buildGalleryImages(
  urls: unknown,
  captions?: unknown,
): GalleryImageInput[] {
  const normalized = normalizeGalleryImageUrls(urls);
  if (normalized.length === 0) return [];

  /**
   * URL → キャプションの対応表を作る。
   *
   * キャプションは «元配列の同じ位置» にあるので、必ず元の添字 i で引く。
   * 「有効な URL だけを数えた連番」で引くと、無効な URL の直後から
   * 1 つずれる (テストで固定済み)。
   *
   * 重複した URL は正規化で 1 つに畳まれるため、
   * 最初に現れたもののキャプションを採用する
   * (同じ写真に別のキャプションを付けることはできない)。
   */
  const captionByUrl = new Map<string, string>();
  if (Array.isArray(urls) && Array.isArray(captions)) {
    for (let i = 0; i < urls.length; i += 1) {
      const raw = urls[i];
      if (!isValidGalleryImageUrl(raw)) continue;
      const key = raw.trim();
      if (captionByUrl.has(key)) continue; // 重複 URL は先勝ち
      const c = captions[i];
      if (typeof c === 'string' && c.trim().length > 0) {
        captionByUrl.set(key, c.trim());
      }
    }
  }

  return normalized.map((url) => ({
    url,
    caption: captionByUrl.get(url) ?? null,
  }));
}
