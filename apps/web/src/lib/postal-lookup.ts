/**
 * 郵便番号 → 住所 (都道府県 / 市区町村・町域) の自動補完ヘルパ。
 *
 * ------------------------------------------------------------------
 * 【障害履歴】2026-08 「いくら郵便番号を打ち込んでも住所が存在しないと表示される」
 * ------------------------------------------------------------------
 * 旧実装はブラウザから `https://zipcloud.ceres.jp/api/search` を直接叩いていたが、
 * このホストは **DNS ごと消滅 (NXDOMAIN)** している。
 *
 *   $ getent hosts zipcloud.ceres.jp   → 応答なし
 *   $ dig zipcloud.ceres.jp            → Status 3 (NXDOMAIN)
 *
 * その結果 fetch は必ず名前解決エラーになり、旧コードの `catch { return null }`
 * に落ちて「どの郵便番号でも null」= 全件「住所が見つかりませんでした」表示となっていた。
 * 郵便番号が実在するかどうかは一切関係なく、100% 失敗する状態だった。
 *
 * ------------------------------------------------------------------
 * 【対策】
 * ------------------------------------------------------------------
 * 1. 生きている公式ホスト `zipcloud.ibsnet.co.jp` に切り替える。
 * 2. 単一ホスト依存をやめ、**複数プロバイダのフォールバック**にする
 *    (1社が再び消滅・停止しても住所検索が全滅しない)。
 * 3. ブラウザから外部 API を直接叩くのをやめ、**自サイトの API 経由 (同一オリジン)** にする。
 *    - 外部サービスの CORS 設定変更・CSP の connect-src に影響されない
 *    - サーバ側でフォールバックとタイムアウトを制御できる
 *    - 会員の郵便番号が外部サービスへ直接送信されない (プライバシー面でも改善)
 * 4. **全角数字を受け付ける**。携帯 (docomo 等) の日本語キーボードは全角数字を
 *    入力しがちで、旧実装は `replace(/[^0-9]/g,'')` のため「１５７００６６」を
 *    空文字にしてしまい、検索も登録バリデーションも通らなかった。NFKC 正規化で対応する。
 * 5. 「該当なし (not-found)」と「検索できなかった (unavailable)」を**区別**する。
 *    旧実装は両方を null にまとめていたため、サービス障害なのに
 *    「住所が存在しない」と誤って案内してしまっていた。
 *
 * なお住所の自動補完はあくまで入力補助であり、**失敗しても手入力で登録できる**。
 * (番地・号は郵便番号から特定できないため、続きは必ずユーザーが入力する)
 */

/** 自動補完で得られた住所 */
export interface PostalAddress {
  /** 都道府県 (例: 東京都) */
  prefecture: string;
  /** 市区町村 + 町域 (例: 世田谷区成城) */
  city: string;
}

/**
 * 住所検索の結果。
 *  - found       … 住所が見つかった
 *  - not-found   … 郵便番号は形式OKだが該当する住所が無い (存在しない郵便番号)
 *  - unavailable … 検索サービスに繋がらない等で「判定できなかった」
 *                  → ユーザーには「存在しない」ではなく「手入力してください」と案内する
 */
export type PostalLookupOutcome =
  | ({ status: 'found' } & PostalAddress)
  | { status: 'not-found' }
  | { status: 'unavailable' };

/**
 * 郵便番号文字列を 7 桁の半角数字に正規化する。7 桁でなければ null。
 *
 * - 全角数字 (１２３) / 全角ハイフン / 全角スペースを NFKC で半角化する
 * - 〒 記号、ハイフン、スペース等の区切り文字は取り除く
 */
export function normalizePostalCode(raw: string): string | null {
  // NFKC で全角英数字・全角記号を半角へ畳み込む (１５７−００６６ → 157-0066)
  const normalized = (raw ?? '').normalize('NFKC');
  const digits = normalized.replace(/[^0-9]/g, '');
  return digits.length === 7 ? digits : null;
}

/** 7桁の郵便番号を 123-4567 形式へ整形する。7桁でなければ入力をそのまま返す。 */
export function formatPostalCode(raw: string): string {
  const zip = normalizePostalCode(raw);
  if (!zip) return raw ?? '';
  return `${zip.slice(0, 3)}-${zip.slice(3)}`;
}

/**
 * 日本郵便のデータに含まれる「町域名ではない注記」を取り除く。
 *
 * 例:
 *  - 「以下に掲載がない場合」          → '' (市区町村までしか分からない)
 *  - 「甲、乙」「次のビルを除く」等の括弧注記 → 除去
 *  - 「大通西（1〜19丁目）」            → 「大通西」
 */
export function cleanTownName(town: string): string {
  let t = (town ?? '').trim();
  if (!t) return '';

  // 「以下に掲載がない場合」= 市区町村までしか特定できないことを示す定型句。
  // 住所欄にそのまま入ると意味不明になるので落とす。
  if (t.startsWith('以下に掲載がない場合')) return '';

  // 「〜の次に番地がくる場合」は町域名 + 注記。注記部分だけ落とす。
  t = t.replace(/の次に番地がくる場合$/, '');

  // 括弧内の注記 (全角・半角) を除去 … 「大通西（1〜19丁目）」→「大通西」
  t = t.replace(/[（(][^）)]*[）)]/g, '');

  // 閉じ括弧が欠けている場合 (データ側の都合) は開き括弧以降を落とす
  t = t.replace(/[（(].*$/, '');

  return t.trim();
}

// ---------------------------------------------------------------------------
// プロバイダごとのレスポンス解析 (純粋関数 — テストしやすいよう fetch と分離)
// ---------------------------------------------------------------------------

/**
 * zipcloud のレスポンス。
 * { status:200, message:null, results:[{ address1:"東京都", address2:"世田谷区",
 *   address3:"成城", ... }] }  / 該当なしは results:null
 */
export function parseZipcloudResponse(json: unknown): PostalLookupOutcome {
  if (!json || typeof json !== 'object') return { status: 'unavailable' };
  const body = json as { results?: unknown; status?: unknown };

  // zipcloud はエラー時 status 400/500 を JSON 本文で返す
  if (typeof body.status === 'number' && body.status !== 200) return { status: 'unavailable' };

  const results = body.results;
  if (results === null || results === undefined) return { status: 'not-found' };
  if (!Array.isArray(results) || results.length === 0) return { status: 'not-found' };

  const first = results[0] as { address1?: unknown; address2?: unknown; address3?: unknown };
  const prefecture = typeof first.address1 === 'string' ? first.address1.trim() : '';
  if (!prefecture) return { status: 'not-found' };

  const ward = typeof first.address2 === 'string' ? first.address2.trim() : '';
  const town = cleanTownName(typeof first.address3 === 'string' ? first.address3 : '');
  return { status: 'found', prefecture, city: `${ward}${town}` };
}

/**
 * jp-postal-code-api (ttskch) のレスポンス — CDN 配信の静的 JSON でとても安定。
 * { postalCode:"1570066", addresses:[{ ja:{ prefecture:"東京都",
 *   address1:"世田谷区", address2:"成城", address3:"", address4:"" } }] }
 * 該当なしは 404。
 */
export function parseJpPostalCodeApiResponse(json: unknown): PostalLookupOutcome {
  if (!json || typeof json !== 'object') return { status: 'unavailable' };
  const addresses = (json as { addresses?: unknown }).addresses;
  if (!Array.isArray(addresses) || addresses.length === 0) return { status: 'not-found' };

  const ja = (addresses[0] as { ja?: unknown }).ja;
  if (!ja || typeof ja !== 'object') return { status: 'unavailable' };
  const a = ja as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  const prefecture = str(a.prefecture);
  if (!prefecture) return { status: 'not-found' };

  const city = [str(a.address1), str(a.address2), str(a.address3), str(a.address4)]
    .map(cleanTownName)
    .join('');
  return { status: 'found', prefecture, city };
}

/** サーバ側で順に試す外部プロバイダ定義 */
export interface PostalProvider {
  name: string;
  url: (zip: string) => string;
  parse: (json: unknown) => PostalLookupOutcome;
}

export const POSTAL_PROVIDERS: PostalProvider[] = [
  {
    // 公式ホスト。旧実装の ceres.jp とは違い現存する。
    name: 'zipcloud',
    url: (zip) => `https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip}`,
    parse: parseZipcloudResponse,
  },
  {
    // GitHub Pages + Cloudflare の静的 JSON。zipcloud が落ちたときの保険。
    name: 'jp-postal-code-api',
    url: (zip) => `https://jp-postal-code-api.ttskch.com/api/v1/${zip}.json`,
    parse: parseJpPostalCodeApiResponse,
  },
];

/** 1プロバイダあたりのタイムアウト (ms)。入力補助なので長く待たせない。 */
export const POSTAL_PROVIDER_TIMEOUT_MS = 4000;

/**
 * 複数プロバイダを順に試して住所を解決する (サーバ側で実行)。
 *
 * - found が得られたら即返す
 * - あるプロバイダが not-found でも、次のプロバイダで見つかる可能性があるため
 *   最後まで試し、全て not-found なら not-found を返す
 * - 全プロバイダが通信失敗なら unavailable (「存在しない」とは言わない)
 */
export async function resolvePostalAddress(
  zip: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PostalLookupOutcome> {
  let sawNotFound = false;

  for (const provider of POSTAL_PROVIDERS) {
    try {
      const res = await fetchImpl(provider.url(zip), {
        signal: AbortSignal.timeout(POSTAL_PROVIDER_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });

      // 404 は「該当なし」として扱う (jp-postal-code-api は該当なしで 404 を返す)
      if (res.status === 404) {
        sawNotFound = true;
        continue;
      }
      if (!res.ok) continue;

      const json = await res.json();
      const outcome = provider.parse(json);
      if (outcome.status === 'found') return outcome;
      if (outcome.status === 'not-found') sawNotFound = true;
    } catch {
      // DNS エラー・タイムアウト・JSON 破損など → 次のプロバイダへ
      continue;
    }
  }

  return sawNotFound ? { status: 'not-found' } : { status: 'unavailable' };
}

// ---------------------------------------------------------------------------
// クライアント側 API
// ---------------------------------------------------------------------------

/**
 * 郵便番号から住所を検索する (ブラウザから呼ぶ)。
 *
 * 外部 API を直接叩かず、自サイトの `/api/postal-lookup` を経由する。
 * @param raw 郵便番号 (全角・ハイフンあり・なしどちらでも可)
 */
export async function lookupPostalCode(raw: string): Promise<PostalLookupOutcome> {
  const zip = normalizePostalCode(raw);
  if (!zip) return { status: 'not-found' };

  try {
    const res = await fetch(`/api/postal-lookup?zipcode=${zip}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { status: 'unavailable' };
    const json = (await res.json()) as PostalLookupOutcome;
    if (json?.status === 'found' && typeof json.prefecture === 'string' && json.prefecture) {
      return { status: 'found', prefecture: json.prefecture, city: json.city ?? '' };
    }
    if (json?.status === 'not-found') return { status: 'not-found' };
    return { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}
