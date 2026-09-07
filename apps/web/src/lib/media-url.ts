/**
 * 相対的なメディア配信パスを、ネイティブアプリからも読める絶対 URL に変換する。
 *
 * ## なぜ必要か（重要）
 *
 * 画像・音声の保存先は二段構えになっている (character-image.ts / game-audio.ts):
 *
 *   1. S3 アセットバケット設定済み → `https://...` の絶対 URL
 *   2. 未設定 (DB フォールバック)   → `/api/media/character-image/<id>?v=...`
 *                                     という **相対パス**
 *
 * Web ブラウザは相対パスを「今見ているサイト」を基準に解決できるので
 * これで動く。しかし **ネイティブアプリ (Flutter) には基準となる
 * オリジンが無い**ため、相対パスを渡すと画像を読み込めない。
 *
 * つまり API のレスポンスに保存された url をそのまま入れると、
 * S3 を設定している環境では動くのに、DB フォールバックの環境では
 * アプリだけ画像が出ない、という環境依存の不具合になる。
 * (この «S3 の有無で挙動が変わる» 罠は、ギャラリーの
 *  imageUrls バリデーションでも同じ形で一度踏んでいる)
 *
 * ## クエリ文字列を保持する理由
 *
 * DB 保存時の url には `?v=<updatedAt>` というキャッシュバスターが付く。
 * 画像を差し替えたときに古い画像が表示され続けるのを防ぐためのもので、
 * 変換時に落としてはいけない。単純な文字列結合で済むよう、
 * ここでは URL の解析を行わず前方一致だけで判定する。
 */

/**
 * 相対パスなら base を前置し、すでに絶対 URL ならそのまま返す。
 *
 * - `null` / 空文字 → `null` (呼び出し側で «未設定» として扱えるように)
 * - `https://...` / `http://...` → そのまま (S3 / CloudFront の URL)
 * - `//example.com/...` → そのまま (プロトコル相対。稀だが壊さない)
 * - `data:` → そのまま (インライン画像)
 * - `/api/media/...` → `${base}/api/media/...`
 */
export function toAbsoluteMediaUrl(
  url: string | null | undefined,
  base: string,
): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed === '') return null;

  // すでに絶対 (スキーム付き / プロトコル相対 / data URI) ならそのまま。
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return trimmed;
  if (/^data:/i.test(trimmed)) return trimmed;

  // base の末尾スラッシュを落としてから結合する。
  // 「//api/media/...」のような二重スラッシュを避けるため。
  const normalizedBase = base.replace(/\/+$/, '');
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${normalizedBase}${path}`;
}

/**
 * slot → URL のマップ (ボイスなど 1 スロット 1 URL) を絶対 URL に変換する。
 *
 * 値が null / 空になったスロットはキーごと落とす。
 * 「キーはあるが値が null」だと、クライアントが
 * 「設定済みだが読み込み失敗」と区別できないため。
 */
export function toAbsoluteUrlMap<K extends string>(
  map: Partial<Record<K, string>>,
  base: string,
): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const [key, value] of Object.entries(map) as [K, string | undefined][]) {
    const abs = toAbsoluteMediaUrl(value, base);
    if (abs) out[key] = abs;
  }
  return out;
}

/**
 * slot → (variant → URL) の二段マップ (キャラクター画像) を
 * 「slot → URL の配列」に変換する。
 *
 * ## なぜ配列に変換するのか
 *
 * Web 版はポーズごとに登録された複数パターンから毎回ランダムに 1 枚を選ぶ
 * (character-image.ts の仕様)。variant の番号自体には意味が無く、
 * クライアントに必要なのは「このポーズで使える画像の一覧」だけ。
 *
 * variant 番号をキーにしたまま返すと、アプリ側が
 * 「1 と 3 は登録済みだが 2 は無い」という歯抜けを自分で扱う必要が出る。
 * 配列にしておけば「ランダムに 1 つ選ぶ」だけで済む。
 *
 * variant の昇順で安定した順序にする。順序が実行ごとに変わると、
 * 表示のテストや不具合の再現がしにくくなる。
 */
export function toAbsoluteUrlListMap<K extends string>(
  // variant 側も Partial で受ける。実際の CharacterImageUrlMap が
  // Partial<Record<number, string>> (歯抜けあり) を使っているため、
  // ここを非 Partial にすると呼び出し側で型が合わない。
  map: Partial<Record<K, Partial<Record<number, string>>>>,
  base: string,
): Partial<Record<K, string[]>> {
  const out: Partial<Record<K, string[]>> = {};
  for (const [key, variants] of Object.entries(map) as [
    K,
    Partial<Record<number, string>> | undefined,
  ][]) {
    if (!variants) continue;
    const urls = Object.keys(variants)
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b)
      .map((v) => toAbsoluteMediaUrl(variants[v], base))
      .filter((u): u is string => u !== null);
    if (urls.length > 0) out[key] = urls;
  }
  return out;
}
