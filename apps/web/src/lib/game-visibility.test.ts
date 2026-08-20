/**
 * ゲームの公開 / 非公開ゲート (lib/game-visibility.ts) のテスト。
 *
 * 【このテストが守っている仕様】
 *  1. 非公開中に一般会員 / 未ログインが API を直接叩いても 404 になる
 *     (ページを隠すだけでは不十分。API が生きていると直接プレイできてしまう)
 *  2. 非公開中でも管理者は API を使える (開発中の動作確認のため)
 *  3. 公開中は誰でも通る
 *  4. AppSetting に設定が保存されていない古いレコードでも
 *     「公開」として扱う (既存サイトが勝手に非公開にならない)
 *  5. 公開中はセッション解決 (DB アクセス) を行わない = 既存の負荷を増やさない
 *  6. 【ゲーム個別】1 本だけ非公開にしても他のゲームは影響を受けない
 *  7. 【マスタースイッチ】gamesVisible が OFF なら個別 ON でも全ゲームが隠れる
 *
 * 実 DB / 実セッションは使わず、依存モジュールをスタブに差し替えて検証する。
 */

/**
 * AppSetting テーブルを模したインメモリ値 (キーごと / beforeEach でリセット)。
 * 2 つのキー (site.sectionVisibility と game.visibility) を読むため、
 * キーを区別して返す必要がある。
 */
let appSettingRows: Record<string, string> = {};
/** resolveApiSession が返すセッション (null = 未ログイン) */
let apiSession: { user: { id: string; role: string } } | null = null;
/** auth() が返すセッション (Server Component 用) */
let cookieSession: { user: { id: string; role: string } } | null = null;
/** resolveApiSession が呼ばれた回数 (公開中はゼロであるべき) */
let resolveApiSessionCalls = 0;

jest.mock('@idol/db', () => ({
  prisma: {
    appSetting: {
      findUnique: ({ where }: { where: { key: string } }) =>
        Promise.resolve(
          appSettingRows[where.key] === undefined
            ? null
            : { key: where.key, value: appSettingRows[where.key] },
        ),
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({}),
  },
  Prisma: { TransactionClient: class {} },
}));

jest.mock('@/auth', () => ({
  auth: () => Promise.resolve(cookieSession),
}));

jest.mock('@/lib/api-auth', () => ({
  resolveApiSession: () => {
    resolveApiSessionCalls += 1;
    return Promise.resolve(apiSession);
  },
}));

import {
  resolveGameVisibility,
  resolveAllGameVisibility,
  resolveGameVisibilityForApi,
  requireGameSectionVisible,
  requireGameVisible,
} from './game-visibility';

/** site.sectionVisibility に保存されている状態を作る */
function setStoredVisibility(v: Record<string, unknown> | null) {
  if (v === null) delete appSettingRows['site.sectionVisibility'];
  else appSettingRows['site.sectionVisibility'] = JSON.stringify(v);
}

/** game.visibility (ゲーム個別) に保存されている状態を作る */
function setStoredGameVisibility(v: Record<string, unknown> | null) {
  if (v === null) delete appSettingRows['game.visibility'];
  else appSettingRows['game.visibility'] = JSON.stringify(v);
}

const ALL_VISIBLE = {
  contentsVisible: true,
  productsVisible: true,
  dmVisible: true,
  gamesVisible: true,
};

const req = () => new Request('https://example.com/api/game/characters');

beforeEach(() => {
  appSettingRows = {};
  apiSession = null;
  cookieSession = null;
  resolveApiSessionCalls = 0;
});

describe('requireGameSectionVisible (API ガード / ゲーム全体)', () => {
  it('公開中は未ログインでも通す', async () => {
    setStoredVisibility(ALL_VISIBLE);
    await expect(requireGameSectionVisible(req())).resolves.toBeUndefined();
  });

  it('非公開中は未ログインを 404 で弾く', async () => {
    setStoredVisibility({ ...ALL_VISIBLE, gamesVisible: false });
    await expect(requireGameSectionVisible(req())).rejects.toMatchObject({
      status: 404,
    });
  });

  it('非公開中は一般会員 (USER) を 404 で弾く', async () => {
    setStoredVisibility({ ...ALL_VISIBLE, gamesVisible: false });
    apiSession = { user: { id: 'u1', role: 'USER' } };
    await expect(requireGameSectionVisible(req())).rejects.toMatchObject({
      status: 404,
    });
  });

  it.each(['ADMIN', 'STAFF', 'SUPER_ADMIN'])(
    '非公開中でも %s は通す (開発中の動作確認のため)',
    async (role) => {
      setStoredVisibility({ ...ALL_VISIBLE, gamesVisible: false });
      apiSession = { user: { id: 'admin1', role } };
      await expect(requireGameSectionVisible(req())).resolves.toBeUndefined();
    },
  );

  it('403 ではなく 404 を返す (未公開ゲームの存在を推測させない)', async () => {
    setStoredVisibility({ ...ALL_VISIBLE, gamesVisible: false });
    await expect(requireGameSectionVisible(req())).rejects.toMatchObject({
      status: 404,
    });
  });

  it('全ゲームを個別に非公開にすると、ゲーム全体としても 404 になる', async () => {
    setStoredVisibility(ALL_VISIBLE);
    setStoredGameVisibility({ acchi: false, slot: false, story: false });
    await expect(requireGameSectionVisible(req())).rejects.toMatchObject({
      status: 404,
    });
  });

  it('1 本でも公開されていればゲーム全体としては通す', async () => {
    setStoredVisibility(ALL_VISIBLE);
    setStoredGameVisibility({ acchi: false, slot: true, story: false });
    await expect(requireGameSectionVisible(req())).resolves.toBeUndefined();
  });
});

describe('requireGameVisible (API ガード / ゲーム個別)', () => {
  it('個別 OFF にしたゲームは未ログインを 404 で弾く', async () => {
    setStoredVisibility(ALL_VISIBLE);
    setStoredGameVisibility({ slot: false });
    await expect(requireGameVisible(req(), 'slot')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('【個別化の核心】1 本を非公開にしても他のゲームは通る', async () => {
    setStoredVisibility(ALL_VISIBLE);
    setStoredGameVisibility({ slot: false });
    await expect(requireGameVisible(req(), 'acchi')).resolves.toBeUndefined();
    await expect(requireGameVisible(req(), 'story')).resolves.toBeUndefined();
  });

  it('個別 OFF でも一般会員 (USER) は 404 / 管理者は通る', async () => {
    setStoredVisibility(ALL_VISIBLE);
    setStoredGameVisibility({ acchi: false });
    apiSession = { user: { id: 'u1', role: 'USER' } };
    await expect(requireGameVisible(req(), 'acchi')).rejects.toMatchObject({
      status: 404,
    });
    apiSession = { user: { id: 'a1', role: 'ADMIN' } };
    await expect(requireGameVisible(req(), 'acchi')).resolves.toBeUndefined();
  });

  it('マスタースイッチが OFF なら個別 ON でも 404 (緊急停止として機能する)', async () => {
    setStoredVisibility({ ...ALL_VISIBLE, gamesVisible: false });
    setStoredGameVisibility({ acchi: true, slot: true, story: true });
    for (const game of ['acchi', 'slot', 'story'] as const) {
      await expect(requireGameVisible(req(), game)).rejects.toMatchObject({
        status: 404,
      });
    }
  });

  it('game.visibility 未設定なら全ゲーム公開扱い (既存サイトが壊れない)', async () => {
    setStoredVisibility(ALL_VISIBLE);
    setStoredGameVisibility(null);
    for (const game of ['acchi', 'slot', 'story'] as const) {
      await expect(requireGameVisible(req(), game)).resolves.toBeUndefined();
    }
  });

  it('新しく追加したゲームのキーが保存されていなくても公開扱い', async () => {
    // 既存 DB には acchi / slot しか保存されていない状態で story を追加した想定。
    setStoredVisibility(ALL_VISIBLE);
    setStoredGameVisibility({ acchi: true, slot: true });
    await expect(requireGameVisible(req(), 'story')).resolves.toBeUndefined();
  });

  it('game.visibility が壊れていても公開扱いにフォールバックする', async () => {
    setStoredVisibility(ALL_VISIBLE);
    appSettingRows['game.visibility'] = '{ broken json';
    await expect(requireGameVisible(req(), 'slot')).resolves.toBeUndefined();
  });
});

describe('resolveGameVisibilityForApi', () => {
  it('公開中はセッション解決を行わない (既存の DB 負荷を増やさない)', async () => {
    setStoredVisibility(ALL_VISIBLE);
    const state = await resolveGameVisibilityForApi(req());
    expect(state).toEqual({ gamesVisible: true, canView: true, isPreview: false });
    expect(resolveApiSessionCalls).toBe(0);
  });

  it('ゲーム個別でも公開中ならセッション解決を行わない (fast path 維持)', async () => {
    setStoredVisibility(ALL_VISIBLE);
    setStoredGameVisibility({ acchi: false, slot: true });
    const state = await resolveGameVisibilityForApi(req(), 'slot');
    expect(state).toEqual({ gamesVisible: true, canView: true, isPreview: false });
    expect(resolveApiSessionCalls).toBe(0);
  });

  it('非公開中はセッションを解決してロールを判定する', async () => {
    setStoredVisibility({ ...ALL_VISIBLE, gamesVisible: false });
    apiSession = { user: { id: 'a', role: 'ADMIN' } };
    const state = await resolveGameVisibilityForApi(req());
    expect(state).toEqual({ gamesVisible: false, canView: true, isPreview: true });
    expect(resolveApiSessionCalls).toBe(1);
  });

  it('個別 OFF のゲームはセッションを解決してロールを判定する', async () => {
    setStoredVisibility(ALL_VISIBLE);
    setStoredGameVisibility({ slot: false });
    apiSession = { user: { id: 'a', role: 'ADMIN' } };
    const state = await resolveGameVisibilityForApi(req(), 'slot');
    // gamesVisible (マスター) は true のままだが、そのゲームはプレビュー扱い。
    expect(state).toEqual({ gamesVisible: true, canView: true, isPreview: true });
    expect(resolveApiSessionCalls).toBe(1);
  });
});

describe('保存済み設定の後方互換', () => {
  it('AppSetting 未設定 (初回) ならゲームは公開扱い', async () => {
    setStoredVisibility(null);
    const state = await resolveGameVisibilityForApi(req());
    expect(state.gamesVisible).toBe(true);
    expect(state.canView).toBe(true);
  });

  it('gamesVisible が無い古いレコードでも公開扱い (勝手に非公開にしない)', async () => {
    // このリリース以前に保存された行には gamesVisible が存在しない。
    setStoredVisibility({
      contentsVisible: true,
      productsVisible: true,
      dmVisible: true,
    });
    const state = await resolveGameVisibilityForApi(req());
    expect(state.gamesVisible).toBe(true);
    expect(state.canView).toBe(true);
  });

  it('壊れた JSON でも公開扱いにフォールバックする (ゲームが不意に消えない)', async () => {
    appSettingRows['site.sectionVisibility'] = '{ this is not json';
    const state = await resolveGameVisibilityForApi(req());
    expect(state.gamesVisible).toBe(true);
    expect(state.canView).toBe(true);
  });

  it('他セクションが非公開でもゲームの公開状態は独立している', async () => {
    setStoredVisibility({
      contentsVisible: false,
      productsVisible: false,
      dmVisible: false,
      gamesVisible: true,
    });
    const state = await resolveGameVisibilityForApi(req());
    expect(state.gamesVisible).toBe(true);
    expect(state.canView).toBe(true);
  });

  it('削除済みゲームのキーが残っていても既知ゲームの設定は保たれる', async () => {
    setStoredVisibility(ALL_VISIBLE);
    setStoredGameVisibility({ removedGame: false, slot: false });
    await expect(requireGameVisible(req(), 'slot')).rejects.toMatchObject({
      status: 404,
    });
    await expect(requireGameVisible(req(), 'acchi')).resolves.toBeUndefined();
  });
});

describe('resolveGameVisibility (Server Component 用 / 引数なし = ゲーム全体)', () => {
  it('公開中は誰でも閲覧でき、プレビュー扱いにならない', async () => {
    setStoredVisibility(ALL_VISIBLE);
    await expect(resolveGameVisibility()).resolves.toEqual({
      gamesVisible: true,
      canView: true,
      isPreview: false,
    });
  });

  it('非公開中の一般会員は閲覧できない', async () => {
    setStoredVisibility({ ...ALL_VISIBLE, gamesVisible: false });
    cookieSession = { user: { id: 'u1', role: 'USER' } };
    await expect(resolveGameVisibility()).resolves.toEqual({
      gamesVisible: false,
      canView: false,
      isPreview: false,
    });
  });

  it('非公開中の管理者はプレビューとして閲覧できる (バナー表示)', async () => {
    setStoredVisibility({ ...ALL_VISIBLE, gamesVisible: false });
    cookieSession = { user: { id: 'a1', role: 'SUPER_ADMIN' } };
    await expect(resolveGameVisibility()).resolves.toEqual({
      gamesVisible: false,
      canView: true,
      isPreview: true,
    });
  });

  it('全ゲーム個別 OFF なら一般会員は /game を開けない', async () => {
    setStoredVisibility(ALL_VISIBLE);
    setStoredGameVisibility({ acchi: false, slot: false, story: false });
    cookieSession = { user: { id: 'u1', role: 'USER' } };
    const state = await resolveGameVisibility();
    expect(state.canView).toBe(false);
  });
});

describe('resolveGameVisibility (Server Component 用 / ゲーム個別)', () => {
  it('公開中のゲームは publiclyVisible: true', async () => {
    setStoredVisibility(ALL_VISIBLE);
    await expect(resolveGameVisibility('slot')).resolves.toEqual({
      game: 'slot',
      gamesVisible: true,
      publiclyVisible: true,
      canView: true,
      isPreview: false,
    });
  });

  it('個別 OFF のゲームは一般会員には見えない', async () => {
    setStoredVisibility(ALL_VISIBLE);
    setStoredGameVisibility({ slot: false });
    cookieSession = { user: { id: 'u1', role: 'USER' } };
    await expect(resolveGameVisibility('slot')).resolves.toEqual({
      game: 'slot',
      gamesVisible: true,
      publiclyVisible: false,
      canView: false,
      isPreview: false,
    });
  });

  it('個別 OFF のゲームは管理者にはプレビュー表示される', async () => {
    setStoredVisibility(ALL_VISIBLE);
    setStoredGameVisibility({ slot: false });
    cookieSession = { user: { id: 'a1', role: 'ADMIN' } };
    await expect(resolveGameVisibility('slot')).resolves.toEqual({
      game: 'slot',
      gamesVisible: true,
      publiclyVisible: false,
      canView: true,
      isPreview: true,
    });
  });

  it('【メタデータ漏洩防止】個別 OFF なら publiclyVisible が false になる', async () => {
    // /game/[characterSlug] の generateMetadata はこの値を見て
    // キャラ名を meta から伏せる。マスターだけ見ていると ADV 個別 OFF のときに
    // タイトル / og:description から未公開ゲームの内容が漏れる。
    setStoredVisibility(ALL_VISIBLE);
    setStoredGameVisibility({ story: false });
    cookieSession = { user: { id: 'a1', role: 'SUPER_ADMIN' } };
    const state = await resolveGameVisibility('story');
    expect(state.publiclyVisible).toBe(false);
    // 管理者本人は閲覧できる (プレビュー) が、meta には出さない。
    expect(state.canView).toBe(true);
  });
});

describe('resolveAllGameVisibility (ゲーム一覧用)', () => {
  it('公開中は全ゲームが閲覧可能', async () => {
    setStoredVisibility(ALL_VISIBLE);
    const state = await resolveAllGameVisibility();
    expect(state.publiclyVisible).toEqual({ acchi: true, slot: true, story: true });
    expect(state.canView).toEqual({ acchi: true, slot: true, story: true });
    expect(state.canViewSection).toBe(true);
    expect(state.isPreview).toBe(false);
  });

  it('一般会員には非公開ゲームだけが canView: false になる', async () => {
    setStoredVisibility(ALL_VISIBLE);
    setStoredGameVisibility({ acchi: false });
    cookieSession = { user: { id: 'u1', role: 'USER' } };
    const state = await resolveAllGameVisibility();
    expect(state.canView).toEqual({ acchi: false, slot: true, story: true });
    // 他が公開されているのでページ自体は開ける。
    expect(state.canViewSection).toBe(true);
  });

  it('管理者には非公開ゲームも canView: true (publiclyVisible は false のまま)', async () => {
    setStoredVisibility(ALL_VISIBLE);
    setStoredGameVisibility({ acchi: false });
    cookieSession = { user: { id: 'a1', role: 'ADMIN' } };
    const state = await resolveAllGameVisibility();
    expect(state.canView.acchi).toBe(true);
    // 「非公開」バッジを出すための情報は保持される。
    expect(state.publiclyVisible.acchi).toBe(false);
  });

  it('全ゲーム非公開なら一般会員はページごと開けない', async () => {
    setStoredVisibility(ALL_VISIBLE);
    setStoredGameVisibility({ acchi: false, slot: false, story: false });
    cookieSession = { user: { id: 'u1', role: 'USER' } };
    const state = await resolveAllGameVisibility();
    expect(state.canViewSection).toBe(false);
  });

  it('全ゲーム非公開でも管理者はプレビューとして全部見られる', async () => {
    setStoredVisibility(ALL_VISIBLE);
    setStoredGameVisibility({ acchi: false, slot: false, story: false });
    cookieSession = { user: { id: 'a1', role: 'SUPER_ADMIN' } };
    const state = await resolveAllGameVisibility();
    expect(state.canViewSection).toBe(true);
    expect(state.isPreview).toBe(true);
    expect(state.canView).toEqual({ acchi: true, slot: true, story: true });
  });
});
