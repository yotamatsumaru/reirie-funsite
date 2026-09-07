/**
 * GET /api/contents/albums の統合テスト。
 *
 * このエンドポイントは「絞り込み前の全件」からアルバムタブを組み立てる。
 * album フィルタを受け付けない (常に全件を集計する) ことと、
 * groupByAlbum() の並び順 (名前付きが先、未設定は末尾「その他」) を
 * そのままレスポンスに反映していることを確認する。
 */

// このファイルを ES モジュールとして扱わせるための空 export。
// (import/export が無いとグローバルスクリプト扱いになり、他の *.test.ts と
//  ローカル変数名がぶつかって `tsc --noEmit` がコンパイルエラーになる)
export {};

type Row = { album: string | null };

let rows: Row[] = [];
let lastFindManyArgs: unknown = null;

jest.mock('@idol/db', () => ({
  prisma: {
    content: {
      findMany: jest.fn(async (args: unknown) => {
        lastFindManyArgs = args;
        return rows;
      }),
    },
  },
}));

jest.mock('@/lib/app-setting', () => ({
  getSiteSectionVisibility: jest.fn(async () => ({ contentsVisible: true })),
}));

async function get(qs = '') {
  const { GET } = await import('./route');
  return GET(new Request(`http://app/api/contents/albums${qs}`));
}

beforeEach(() => {
  rows = [];
  lastFindManyArgs = null;
  jest.clearAllMocks();
});

describe('GET /api/contents/albums', () => {
  it('名前付きアルバムを最初に現れた順、未設定は末尾「その他」として集計する', async () => {
    rows = [
      { album: '2024夏ツアー' },
      { album: null },
      { album: '2024夏ツアー' },
      { album: '2025春' },
      { album: null },
    ];

    const res = await get('?type=GALLERY');
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.albums).toEqual([
      { name: '2024夏ツアー', key: '2024夏ツアー', count: 2 },
      { name: '2025春', key: '2025春', count: 1 },
      { name: 'その他', key: '__none__', count: 2 },
    ]);
  });

  it('未設定グループが無い場合は「その他」を含めない', async () => {
    rows = [{ album: 'A' }, { album: 'B' }];

    const res = await get('?type=GALLERY');
    const body = await res.json();
    expect(body.albums.map((a: { name: string }) => a.name)).toEqual(['A', 'B']);
  });

  it('type クエリ省略時は GALLERY を既定値として使う', async () => {
    rows = [];
    await get();
    const args = lastFindManyArgs as { where: { type: string } };
    expect(args.where.type).toBe('GALLERY');
  });

  it('type=BLOG を指定すればブログ側の集計になる', async () => {
    rows = [];
    await get('?type=BLOG');
    const args = lastFindManyArgs as { where: { type: string } };
    expect(args.where.type).toBe('BLOG');
  });

  it('件数はプランに関わらず全件を数える (閲覧不可のものも除外しない)', async () => {
    // このエンドポイントは accessLevel を一切見ない実装であることの回帰確認。
    // where 条件に accessLevel が含まれていないことを確認する。
    rows = [{ album: 'A' }];
    await get('?type=GALLERY');
    const args = lastFindManyArgs as { where: Record<string, unknown> };
    expect(args.where).not.toHaveProperty('accessLevel');
  });

  it('contentsVisible=false のとき 404 を返す', async () => {
    const appSetting = jest.requireMock('@/lib/app-setting') as {
      getSiteSectionVisibility: jest.Mock;
    };
    appSetting.getSiteSectionVisibility.mockResolvedValueOnce({ contentsVisible: false });

    const res = await get('?type=GALLERY');
    expect(res.status).toBe(404);
  });
});
