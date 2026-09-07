/**
 * GET /api/contents の統合テスト。
 *
 * 特に GALLERY 種別は「見えないものを除外する」既存の他種別 (BLOG 等) とは
 * 挙動が異なり (鍵付きで見せる)、実装を間違えると
 *   - 閲覧不可なのに coverImageUrl / previewImages (写真の URL) が漏れる
 *   - 閲覧可能なのに unlocked が false になり画像が出ない
 *   - 逆に伏せすぎて Web 版と表示が食い違う (imageCount は鍵付きでも返す)
 * のどちらの方向にも壊れうる。ロジックの分岐点をここで固定する。
 *
 * DB (@idol/db) と認証 (@/lib/api-auth) と公開設定 (@/lib/app-setting) を
 * モックし、実際の Route Handler (GET) を通して検証する。
 */

// このファイルを ES モジュールとして扱わせるための空 export。
// (import/export が無いとグローバルスクリプト扱いになり、他の *.test.ts と
//  ローカル変数名がぶつかって `tsc --noEmit` がコンパイルエラーになる)
export {};

type ContentRow = {
  id: string;
  type: 'BLOG' | 'GALLERY';
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  accessLevel: 'PUBLIC' | 'FREE_MEMBERS' | 'MEMBERS' | 'PREMIUM';
  album: string | null;
  publishedAt: Date | null;
  authorName: string | null;
  tags: string[];
  viewCount: number;
  images: { url: string; caption: string | null }[];
  _count: { images: number };
};

let rows: ContentRow[] = [];
let lastFindManyArgs: unknown = null;

jest.mock('@idol/db', () => ({
  prisma: {
    content: {
      findMany: jest.fn(async (args: unknown) => {
        lastFindManyArgs = args;
        // ページネーションは本テストでは検証対象外なので全件返す。
        return rows;
      }),
      count: jest.fn(async () => rows.length),
    },
  },
}));

jest.mock('@/lib/app-setting', () => ({
  getSiteSectionVisibility: jest.fn(async () => ({ contentsVisible: true })),
}));

let currentPlan: 'FREE' | 'STANDARD' | 'PREMIUM' | undefined;

jest.mock('@/lib/api-auth', () => ({
  resolveApiSession: jest.fn(async () => {
    if (!currentPlan) return null;
    return { user: { id: 'u1', plan: currentPlan } };
  }),
}));

function makeGallery(overrides: Partial<ContentRow>): ContentRow {
  return {
    id: 'g1',
    type: 'GALLERY',
    slug: 'g1',
    title: 'ギャラリー1',
    excerpt: null,
    coverImageUrl: null,
    accessLevel: 'PREMIUM',
    album: null,
    publishedAt: new Date('2024-01-01'),
    authorName: 'staff',
    tags: [],
    viewCount: 0,
    images: [
      { url: '/img/1.jpg', caption: null },
      { url: '/img/2.jpg', caption: null },
    ],
    _count: { images: 2 },
    ...overrides,
  };
}

async function get(qs: string) {
  const { GET } = await import('./route');
  return GET(new Request(`http://app/api/contents${qs}`));
}

beforeEach(() => {
  rows = [];
  lastFindManyArgs = null;
  currentPlan = undefined;
  jest.clearAllMocks();
});

describe('GET /api/contents?type=GALLERY (鍵付き一覧)', () => {
  it('閲覧不可 (プラン不足) の場合、unlocked=false でカバー画像/プレビューを一切返さない', async () => {
    rows = [makeGallery({ accessLevel: 'PREMIUM', coverImageUrl: '/cover.jpg' })];
    currentPlan = 'FREE';

    const res = await get('?type=GALLERY');
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    expect(item.unlocked).toBe(false);
    expect(item.coverImageUrl).toBeNull();
    expect(item.previewImages).toEqual([]);
  });

  it('閲覧不可でも「写真の枚数」は返す (Web版 /gallery と揃える)', async () => {
    // Web版はロック済みカードにも「写真 N 枚」バッジを出している
    // (total を unlocked と無関係に算出しているため)。
    // ここで 0 を返すとアプリだけ「写真 0 枚」になり表示が食い違う。
    // 伏せるべきなのは写真の URL (中身) であって枚数ではない。
    rows = [makeGallery({ accessLevel: 'PREMIUM' })];
    currentPlan = 'FREE';

    const body = await (await get('?type=GALLERY')).json();
    const item = body.items[0];
    expect(item.unlocked).toBe(false);
    expect(item.imageCount).toBe(2);
    // 枚数は出すが、中身 (URL) は漏らさないことを同時に固定する
    expect(item.previewImages).toEqual([]);
    expect(item.coverImageUrl).toBeNull();
  });

  it('閲覧可能な場合、unlocked=true でカバー画像/プレビュー/枚数を返す', async () => {
    rows = [makeGallery({ accessLevel: 'FREE_MEMBERS', coverImageUrl: null })];
    currentPlan = 'FREE';

    const res = await get('?type=GALLERY');
    const body = await res.json();

    const item = body.items[0];
    expect(item.unlocked).toBe(true);
    // coverImageUrl が未設定なら 1 枚目の画像を代表として使う (resolveGalleryCover)
    expect(item.coverImageUrl).toBe('/img/1.jpg');
    expect(item.previewImages).toEqual(['/img/1.jpg', '/img/2.jpg']);
    expect(item.imageCount).toBe(2);
  });

  it('未ログイン (plan未設定) でも PUBLIC/FREE_MEMBERS 相当以下のギャラリーは閲覧不可としない場合がある点を確認する', async () => {
    // FREE_MEMBERS はログインのみで足りるが、未ログインは canAccess() 側で弾かれる。
    rows = [makeGallery({ accessLevel: 'FREE_MEMBERS' })];
    currentPlan = undefined;

    const res = await get('?type=GALLERY');
    const body = await res.json();
    expect(body.items[0].unlocked).toBe(false);
  });

  it('アクセス不可のアイテムも一覧から除外せず、鍵付きカードとして返す (Web版と同じ方針)', async () => {
    rows = [
      makeGallery({ id: 'g1', accessLevel: 'PREMIUM' }),
      makeGallery({ id: 'g2', accessLevel: 'PUBLIC' }),
    ];
    currentPlan = 'FREE';

    const res = await get('?type=GALLERY');
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it('album クエリを albumFilterWhere() 経由で where 条件に反映する', async () => {
    rows = [makeGallery({ album: '2024夏' })];
    currentPlan = 'PREMIUM';

    await get('?type=GALLERY&album=2024%E5%A4%8F');

    const args = lastFindManyArgs as { where: { album?: string | null } };
    expect(args.where.album).toBe('2024夏');
  });

  it('album=__none__ (未設定グループ) は where.album=null に変換される', async () => {
    rows = [makeGallery({ album: null })];
    currentPlan = 'PREMIUM';

    await get('?type=GALLERY&album=__none__');

    const args = lastFindManyArgs as { where: { album?: string | null } };
    expect(args.where.album).toBeNull();
  });

  it('レスポンスの album は normalizeAlbumName() で正規化された値になる', async () => {
    rows = [makeGallery({ album: '  2024夏  ' })];
    currentPlan = 'PREMIUM';

    const res = await get('?type=GALLERY');
    const body = await res.json();
    expect(body.items[0].album).toBe('2024夏');
  });
});

describe('GET /api/contents?type=BLOG (既存挙動の回帰確認)', () => {
  it('GALLERY 用のフィールド (unlocked 等) を含まず、accessLevel で絞り込む既存挙動を維持する', async () => {
    rows = [
      {
        id: 'b1',
        type: 'BLOG',
        slug: 'b1',
        title: 'ブログ1',
        excerpt: null,
        coverImageUrl: '/blog-cover.jpg',
        accessLevel: 'PUBLIC',
        album: null,
        publishedAt: new Date('2024-01-01'),
        authorName: 'staff',
        tags: [],
        viewCount: 0,
        images: [],
        _count: { images: 0 },
      },
    ];
    currentPlan = undefined;

    const res = await get('?type=BLOG');
    const body = await res.json();

    expect(body.items).toHaveLength(1);
    expect(body.items[0]).not.toHaveProperty('unlocked');
    expect(body.items[0]).not.toHaveProperty('previewImages');
    expect(body.items[0].coverImageUrl).toBe('/blog-cover.jpg');

    const args = lastFindManyArgs as { where: { accessLevel: { in: string[] } } };
    expect(args.where.accessLevel.in).toEqual(['PUBLIC']);
  });
});

describe('GET /api/contents: コンテンツ非公開設定', () => {
  it('contentsVisible=false のとき 404 を返す', async () => {
    const appSetting = jest.requireMock('@/lib/app-setting') as {
      getSiteSectionVisibility: jest.Mock;
    };
    appSetting.getSiteSectionVisibility.mockResolvedValueOnce({ contentsVisible: false });

    const res = await get('?type=GALLERY');
    expect(res.status).toBe(404);
  });
});
