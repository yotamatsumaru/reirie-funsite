/**
 * 郵便番号 → 住所 (都道府県 / 市区町村・町域) の自動補完ヘルパ。
 *
 * zipcloud (https://zipcloud.ceres.jp/) の無料 API を利用する。
 *  - CORS 許可済みのためブラウザから直接叩ける (サーバ側のプロキシ不要)。
 *  - API キー不要・無料。
 *  - レスポンス例:
 *      { status: 200, message: null, results: [
 *          { zipcode:"1570066", prefcode:"13", address1:"東京都",
 *            address2:"世田谷区", address3:"成城", kana1, kana2, kana3 } ] }
 *      results が null の場合は該当なし。
 *
 * 自動補完の方針:
 *  - address1 → 都道府県 (prefecture)
 *  - address2 + address3 → 市区町村・町域 (addressLine1 のたたき台)。
 *    番地・号までは郵便番号から特定できないため、ユーザーが続きを入力する。
 *
 * 通信失敗・該当なしのときは null を返し、呼び出し側で「自動入力できなかった」
 * 扱いにする (手入力にフォールバック)。住所入力自体をブロックしない。
 */

export interface PostalLookupResult {
  /** 都道府県 (例: 東京都) */
  prefecture: string;
  /** 市区町村 + 町域 (例: 世田谷区成城) */
  city: string;
}

interface ZipcloudResponse {
  status: number;
  message: string | null;
  results:
    | Array<{
        address1: string;
        address2: string;
        address3: string;
      }>
    | null;
}

/** 郵便番号文字列を 7 桁の数字だけに正規化する (ハイフン等を除去)。7 桁でなければ null。 */
export function normalizePostalCode(raw: string): string | null {
  const digits = (raw ?? '').replace(/[^0-9]/g, '');
  return digits.length === 7 ? digits : null;
}

/**
 * 郵便番号から住所を検索する。
 * @param raw 郵便番号 (ハイフンあり・なしどちらでも可)
 * @returns 見つかれば { prefecture, city }、該当なし・通信失敗なら null
 */
export async function lookupPostalCode(raw: string): Promise<PostalLookupResult | null> {
  const zip = normalizePostalCode(raw);
  if (!zip) return null;

  try {
    const res = await fetch(`https://zipcloud.ceres.jp/api/search?zipcode=${zip}`, {
      // 住所補完はあくまで補助。多少古くても問題ないためブラウザキャッシュを許可する。
      cache: 'force-cache',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as ZipcloudResponse;
    const first = json.results?.[0];
    if (!first) return null;

    const prefecture = first.address1?.trim() ?? '';
    const city = `${first.address2 ?? ''}${first.address3 ?? ''}`.trim();
    if (!prefecture) return null;

    return { prefecture, city };
  } catch {
    // ネットワークエラー等は握りつぶし、手入力にフォールバックさせる
    return null;
  }
}
