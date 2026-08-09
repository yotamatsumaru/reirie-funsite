/**
 * 郵便番号 → 住所 検索のリグレッションテスト。
 *
 * 【この機能で起きた本番障害】
 * 旧実装はブラウザから `zipcloud.ceres.jp` を直接叩いていたが、そのホストが
 * DNS ごと消滅 (NXDOMAIN) したため fetch が常に例外となり、
 * `catch { return null }` によって **どの郵便番号でも「住所が存在しない」** と
 * 表示され、新規会員登録が完全にブロックされていた。
 *
 * 以下のテストは、その再発を防ぐことを主目的にしている:
 *  1. 通信失敗は 'not-found' ではなく 'unavailable' になる (「存在しない」と誤案内しない)
 *  2. 1社が落ちても別プロバイダで住所が引ける (単一ホスト依存にしない)
 *  3. 全角数字でも 7 桁として認識される (携帯の日本語入力対策)
 */
import {
  cleanTownName,
  formatPostalCode,
  normalizePostalCode,
  parseJpPostalCodeApiResponse,
  parseZipcloudResponse,
  POSTAL_PROVIDERS,
  resolvePostalAddress,
} from './postal-lookup';

// --- テスト用の fetch モックヘルパ -----------------------------------------

/** JSON を返す Response 相当のモック */
function jsonRes(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** ネットワークエラー (DNS 解決失敗) を再現する */
function networkError() {
  return Promise.reject(new TypeError('fetch failed'));
}

const ZIPCLOUD_OK = {
  status: 200,
  message: null,
  results: [
    { address1: '東京都', address2: '世田谷区', address3: '成城', prefcode: '13', zipcode: '1570066' },
  ],
};

const JP_API_OK = {
  postalCode: '1570066',
  addresses: [
    {
      prefectureCode: '13',
      ja: { prefecture: '東京都', address1: '世田谷区', address2: '成城', address3: '', address4: '' },
    },
  ],
};

describe('normalizePostalCode', () => {
  it('ハイフンあり・なしどちらも7桁に正規化する', () => {
    expect(normalizePostalCode('1570066')).toBe('1570066');
    expect(normalizePostalCode('157-0066')).toBe('1570066');
  });

  it('〒記号やスペースが混ざっていても正規化する', () => {
    expect(normalizePostalCode('〒157-0066')).toBe('1570066');
    expect(normalizePostalCode(' 157 0066 ')).toBe('1570066');
  });

  it('【回帰】全角数字を半角に畳み込む (携帯の日本語キーボード対策)', () => {
    // 旧実装は replace(/[^0-9]/g,'') だけだったため空文字になり、
    // 「住所が見つからない」かつ登録バリデーションも通らなかった。
    expect(normalizePostalCode('１５７００６６')).toBe('1570066');
    expect(normalizePostalCode('１５７−００６６')).toBe('1570066'); // 全角ハイフン
    expect(normalizePostalCode('１５７－００６６')).toBe('1570066'); // 全角ダッシュ
  });

  it('7桁でなければ null を返す', () => {
    expect(normalizePostalCode('157')).toBeNull();
    expect(normalizePostalCode('15700661')).toBeNull();
    expect(normalizePostalCode('')).toBeNull();
    expect(normalizePostalCode('abcdefg')).toBeNull();
  });

  it('先頭が 0 の郵便番号でも桁落ちしない', () => {
    expect(normalizePostalCode('0640941')).toBe('0640941');
    expect(normalizePostalCode('064-0941')).toBe('0640941');
  });
});

describe('formatPostalCode', () => {
  it('7桁を 123-4567 形式へ整形する', () => {
    expect(formatPostalCode('1570066')).toBe('157-0066');
    expect(formatPostalCode('157-0066')).toBe('157-0066');
    expect(formatPostalCode('０６４０９４１')).toBe('064-0941');
  });

  it('サーバの検証 /^\\d{3}-?\\d{4}$/ を通る形になる', () => {
    expect(/^\d{3}-?\d{4}$/.test(formatPostalCode('１５７００６６'))).toBe(true);
    expect(/^\d{3}-?\d{4}$/.test(formatPostalCode('〒157 0066'))).toBe(true);
  });

  it('7桁でない入力はそのまま返す (サーバ側で弾かせる)', () => {
    expect(formatPostalCode('157')).toBe('157');
  });
});

describe('cleanTownName', () => {
  it('「以下に掲載がない場合」は町域名ではないので落とす', () => {
    expect(cleanTownName('以下に掲載がない場合')).toBe('');
  });

  it('括弧内の注記を除去する', () => {
    expect(cleanTownName('大通西（1〜19丁目）')).toBe('大通西');
    expect(cleanTownName('成城(次のビルを除く)')).toBe('成城');
  });

  it('「〜の次に番地がくる場合」は注記部分だけ落とす', () => {
    expect(cleanTownName('丸の内の次に番地がくる場合')).toBe('丸の内');
  });

  it('通常の町域名はそのまま返す', () => {
    expect(cleanTownName('成城')).toBe('成城');
    expect(cleanTownName('')).toBe('');
  });
});

describe('parseZipcloudResponse', () => {
  it('住所が見つかったら found を返す', () => {
    expect(parseZipcloudResponse(ZIPCLOUD_OK)).toEqual({
      status: 'found',
      prefecture: '東京都',
      city: '世田谷区成城',
    });
  });

  it('results: null は not-found', () => {
    expect(parseZipcloudResponse({ status: 200, message: null, results: null })).toEqual({
      status: 'not-found',
    });
  });

  it('町域が「以下に掲載がない場合」なら市区町村までを返す', () => {
    const res = parseZipcloudResponse({
      status: 200,
      results: [{ address1: '北海道', address2: '札幌市中央区', address3: '以下に掲載がない場合' }],
    });
    expect(res).toEqual({ status: 'found', prefecture: '北海道', city: '札幌市中央区' });
  });

  it('町域が空でも市区町村までを返す', () => {
    const res = parseZipcloudResponse({
      status: 200,
      results: [{ address1: '東京都', address2: '千代田区', address3: '' }],
    });
    expect(res).toEqual({ status: 'found', prefecture: '東京都', city: '千代田区' });
  });

  it('API 側のエラー status は unavailable (not-found にしない)', () => {
    expect(parseZipcloudResponse({ status: 400, message: 'error', results: null })).toEqual({
      status: 'unavailable',
    });
  });

  it('壊れた本文は unavailable', () => {
    expect(parseZipcloudResponse(null)).toEqual({ status: 'unavailable' });
    expect(parseZipcloudResponse('not json')).toEqual({ status: 'unavailable' });
  });
});

describe('parseJpPostalCodeApiResponse', () => {
  it('住所が見つかったら found を返す', () => {
    expect(parseJpPostalCodeApiResponse(JP_API_OK)).toEqual({
      status: 'found',
      prefecture: '東京都',
      city: '世田谷区成城',
    });
  });

  it('addresses が空なら not-found', () => {
    expect(parseJpPostalCodeApiResponse({ postalCode: '9999999', addresses: [] })).toEqual({
      status: 'not-found',
    });
  });

  it('壊れた本文は unavailable', () => {
    expect(parseJpPostalCodeApiResponse(undefined)).toEqual({ status: 'unavailable' });
  });
});

describe('POSTAL_PROVIDERS', () => {
  it('【回帰】消滅したホスト zipcloud.ceres.jp を使っていない', () => {
    // このホストは DNS ごと消滅しており、参照すると住所検索が全滅する。
    for (const p of POSTAL_PROVIDERS) {
      expect(p.url('1570066')).not.toContain('ceres.jp');
    }
  });

  it('単一障害点を避けるため2つ以上のプロバイダを持つ', () => {
    expect(POSTAL_PROVIDERS.length).toBeGreaterThanOrEqual(2);
  });

  it('すべて https で通信する', () => {
    for (const p of POSTAL_PROVIDERS) {
      expect(p.url('1570066').startsWith('https://')).toBe(true);
    }
  });

  it('郵便番号が URL に正しく埋め込まれる', () => {
    for (const p of POSTAL_PROVIDERS) {
      expect(p.url('1570066')).toContain('1570066');
    }
  });
});

describe('resolvePostalAddress', () => {
  it('1社目で見つかればそこで打ち切る', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonRes(ZIPCLOUD_OK));
    const res = await resolvePostalAddress('1570066', fetchMock as unknown as typeof fetch);
    expect(res).toEqual({ status: 'found', prefecture: '東京都', city: '世田谷区成城' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('【回帰】1社目が DNS エラーでも2社目で住所を引ける', async () => {
    // まさに本番で起きた状況 (ceres.jp が NXDOMAIN) の再現。
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(() => networkError())
      .mockResolvedValueOnce(jsonRes(JP_API_OK));
    const res = await resolvePostalAddress('1570066', fetchMock as unknown as typeof fetch);
    expect(res).toEqual({ status: 'found', prefecture: '東京都', city: '世田谷区成城' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('【最重要回帰】全プロバイダが通信失敗なら unavailable (not-found にしない)', async () => {
    // ここを not-found にしてしまうと、サービス障害中に
    // 「住所が存在しない」と誤案内し会員登録をブロックする = 今回の障害そのもの。
    const fetchMock = jest.fn().mockImplementation(() => networkError());
    const res = await resolvePostalAddress('1570066', fetchMock as unknown as typeof fetch);
    expect(res).toEqual({ status: 'unavailable' });
    expect(res.status).not.toBe('not-found');
  });

  it('全プロバイダが 5xx でも unavailable', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonRes({}, 503));
    const res = await resolvePostalAddress('1570066', fetchMock as unknown as typeof fetch);
    expect(res).toEqual({ status: 'unavailable' });
  });

  it('実在しない郵便番号は not-found を返す', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonRes({ status: 200, results: null }))
      .mockResolvedValueOnce(jsonRes({}, 404));
    const res = await resolvePostalAddress('9999999', fetchMock as unknown as typeof fetch);
    expect(res).toEqual({ status: 'not-found' });
  });

  it('1社が not-found でも他社で見つかればそれを採用する', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonRes({ status: 200, results: null }))
      .mockResolvedValueOnce(jsonRes(JP_API_OK));
    const res = await resolvePostalAddress('1570066', fetchMock as unknown as typeof fetch);
    expect(res).toEqual({ status: 'found', prefecture: '東京都', city: '世田谷区成城' });
  });

  it('not-found と通信失敗が混在する場合は not-found を優先する', async () => {
    // 少なくとも1社が「該当なし」と明確に答えているので、番号の確認を促せる。
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonRes({ status: 200, results: null }))
      .mockImplementationOnce(() => networkError());
    const res = await resolvePostalAddress('9999999', fetchMock as unknown as typeof fetch);
    expect(res).toEqual({ status: 'not-found' });
  });

  it('JSON が壊れていても例外を投げず次へ進む', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      } as unknown as Response)
      .mockResolvedValueOnce(jsonRes(JP_API_OK));
    const res = await resolvePostalAddress('1570066', fetchMock as unknown as typeof fetch);
    expect(res).toEqual({ status: 'found', prefecture: '東京都', city: '世田谷区成城' });
  });

  it('タイムアウト用の signal を渡している (無限に待たせない)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonRes(ZIPCLOUD_OK));
    await resolvePostalAddress('1570066', fetchMock as unknown as typeof fetch);
    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBeDefined();
  });
});
