/**
 * ゲームの公開 / 非公開ゲート (lib/game-visibility.ts) のテスト。
 *
 * 【このテストが守っている仕様】
 *  1. 非公開中に一般会員 / 未ログインが API を直接叩いても 404 になる
 *     (ページを隠すだけでは不十分。API が生きていると直接プレイできてしまう)
 *  2. 非公開中でも管理者は API を使える (開発中の動作確認のため)
 *  3. 公開中は誰でも通る
 *  4. AppSetting に gamesVisible が保存されていない古いレコードでも
 *     「公開」として扱う (既存サイトが勝手に非公開にならない)
 *  5. 公開中はセッション解決 (DB アクセス) を行わない = 既存の負荷を増やさない
 *
 * 実 DB / 実セッションは使わず、依存モジュールをスタブに差し替えて検証する。
 */

/** AppSetting テーブルを模したインメモリ値 (beforeEach でリセット) */
let appSettingValue: string | null = null;
/** resolveApiSession が返すセッション (null = 未ログイン) */
let apiSession: { user: { id: string; role: string } } | null = null;
/** auth() が返すセッション (Server Component 用) */
let cookieSession: { user: { id: string; role: string } } | null = null;
/** resolveApiSession が呼ばれた回数 (公開中はゼロであるべき) */
let resolveApiSessionCalls = 0;

jest.mock('@idol/db', () => ({
  prisma: {
    appSetting: {
      findUnique: () =>
        Promise.resolve(
          appSettingValue === null
            ? null
            : { key: 'site.sectionVisibility', value: appSettingValue },
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
  resolveGameVisibilityForApi,
  requireGameSectionVisible,
} from './game-visibility';

/** AppSetting に保存されている状態を作る */
function setStoredVisibility(v: Record<string, unknown> | null) {
  appSettingValue = v === null ? null : JSON.stringify(v);
}

const ALL_VISIBLE = {
  contentsVisible: true,
  productsVisible: true,
  dmVisible: true,
  gamesVisible: true,
};

const req = () => new Request('https://example.com/api/game/characters');

beforeEach(() => {
  appSettingValue = null;
  apiSession = null;
  cookieSession = null;
  resolveApiSessionCalls = 0;
});

describe('requireGameSectionVisible (API ガード)', () => {
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
});

describe('resolveGameVisibilityForApi', () => {
  it('公開中はセッション解決を行わない (既存の DB 負荷を増やさない)', async () => {
    setStoredVisibility(ALL_VISIBLE);
    const state = await resolveGameVisibilityForApi(req());
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
    appSettingValue = '{ this is not json';
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
});

describe('resolveGameVisibility (Server Component 用)', () => {
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
});
