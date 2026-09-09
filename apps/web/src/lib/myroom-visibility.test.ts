/**
 * MyRoom の公開 / 非公開ゲート (lib/myroom-visibility.ts) のテスト。
 *
 * 【このテストが守っている仕様】
 *  1. 非公開中に一般会員 / 未ログインが API を直接叩いても 404 になる
 *     (ページを隠すだけでは不十分。API が生きているとデータを取得できてしまう)
 *  2. 非公開中でも管理者は閲覧できる (開発中の動作確認のため)
 *  3. 非公開中の管理者には isPreview: true が立つ
 *     (「公開したつもりで非公開のまま」の事故を防ぐバナー用)
 *  4. 公開したら一般会員も見られる
 *  5. 設定が未保存の場合は「非公開」として扱う
 *     ← ゲームとは逆。未完成の機能が既定で会員に露出しないようにするため
 *
 * 実 DB / 実セッションは使わず、依存モジュールをスタブに差し替えて検証する。
 */

/** AppSetting テーブルを模したインメモリ値 (beforeEach でリセット) */
let appSettingRows: Record<string, string> = {};
/** resolveApiSession が返すセッション (null = 未ログイン) */
let apiSession: { user: { id: string; role: string } } | null = null;
/** auth() が返すセッション (Server Component 用) */
let cookieSession: { user: { id: string; role: string } } | null = null;

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
  resolveApiSession: () => Promise.resolve(apiSession),
}));

import {
  resolveMyRoomVisibility,
  resolveMyRoomVisibilityForApi,
  requireMyRoomVisible,
} from './myroom-visibility';

/** site.sectionVisibility に保存されている状態を作る */
function setStored(v: Record<string, unknown> | null) {
  if (v === null) delete appSettingRows['site.sectionVisibility'];
  else appSettingRows['site.sectionVisibility'] = JSON.stringify(v);
}

/** 他セクションは公開、MyRoom だけ指定値にする */
function withMyRoom(visible: boolean) {
  return {
    contentsVisible: true,
    productsVisible: true,
    dmVisible: true,
    videosVisible: true,
    gamesVisible: true,
    myRoomVisible: visible,
  };
}

const req = () => new Request('http://localhost/api/myroom/furnitures');

beforeEach(() => {
  appSettingRows = {};
  apiSession = null;
  cookieSession = null;
});

describe('resolveMyRoomVisibility (Server Component 用)', () => {
  it('非公開中の未ログインは閲覧できない', async () => {
    setStored(withMyRoom(false));
    const state = await resolveMyRoomVisibility();
    expect(state.myRoomVisible).toBe(false);
    expect(state.canView).toBe(false);
    // 見えていないのでプレビューバナーも出さない
    expect(state.isPreview).toBe(false);
  });

  it('非公開中の一般会員 (USER) は閲覧できない', async () => {
    setStored(withMyRoom(false));
    cookieSession = { user: { id: 'u1', role: 'USER' } };
    const state = await resolveMyRoomVisibility();
    expect(state.canView).toBe(false);
    expect(state.isPreview).toBe(false);
  });

  /**
   * 今回のご依頼の中心。非公開でも管理者だけは見られる必要がある
   * (開発中の動作確認ができないと、公開直前まで一度も触れない)。
   */
  it.each(['ADMIN', 'STAFF', 'SUPER_ADMIN'])(
    '非公開中でも %s はプレビューできる',
    async (role) => {
      setStored(withMyRoom(false));
      cookieSession = { user: { id: 'a1', role } };
      const state = await resolveMyRoomVisibility();
      expect(state.canView).toBe(true);
      // 「非公開中」バナーを出すためのフラグ
      expect(state.isPreview).toBe(true);
    },
  );

  it('公開すれば一般会員も閲覧でき、プレビュー扱いにならない', async () => {
    setStored(withMyRoom(true));
    cookieSession = { user: { id: 'u1', role: 'USER' } };
    const state = await resolveMyRoomVisibility();
    expect(state.canView).toBe(true);
    expect(state.isPreview).toBe(false);
  });

  it('公開中の管理者はプレビュー扱いにならない (バナーを出さない)', async () => {
    setStored(withMyRoom(true));
    cookieSession = { user: { id: 'a1', role: 'ADMIN' } };
    const state = await resolveMyRoomVisibility();
    expect(state.canView).toBe(true);
    expect(state.isPreview).toBe(false);
  });

  /**
   * ゲームとは «逆» の既定値であることを固定する。
   * ゲームは既存サイトで公開済みのため未設定 = 公開だが、
   * MyRoom は未完成なので未設定 = 非公開でなければならない。
   * ここが反転すると、デプロイした瞬間に開発中の画面が会員へ露出する。
   */
  it('設定が未保存なら非公開として扱う (未完成機能が既定で露出しない)', async () => {
    setStored(null);
    cookieSession = { user: { id: 'u1', role: 'USER' } };
    const state = await resolveMyRoomVisibility();
    expect(state.myRoomVisible).toBe(false);
    expect(state.canView).toBe(false);
  });

  it('設定が未保存でも管理者は閲覧できる', async () => {
    setStored(null);
    cookieSession = { user: { id: 'a1', role: 'ADMIN' } };
    const state = await resolveMyRoomVisibility();
    expect(state.canView).toBe(true);
    expect(state.isPreview).toBe(true);
  });

  it('壊れた設定値でも例外にせず非公開として扱う', async () => {
    appSettingRows['site.sectionVisibility'] = '{ this is not json';
    cookieSession = { user: { id: 'u1', role: 'USER' } };
    const state = await resolveMyRoomVisibility();
    expect(state.canView).toBe(false);
  });

  it('myRoomVisible だけ未指定でも非公開として扱う (部分保存への耐性)', async () => {
    setStored({ contentsVisible: true, gamesVisible: true });
    cookieSession = { user: { id: 'u1', role: 'USER' } };
    const state = await resolveMyRoomVisibility();
    expect(state.myRoomVisible).toBe(false);
    expect(state.canView).toBe(false);
  });
});

describe('resolveMyRoomVisibilityForApi (API 用)', () => {
  it('非公開中の未ログインは閲覧できない', async () => {
    setStored(withMyRoom(false));
    const state = await resolveMyRoomVisibilityForApi(req());
    expect(state.canView).toBe(false);
  });

  it('非公開中でも管理者は閲覧できる (Bearer / Cookie どちらでも)', async () => {
    setStored(withMyRoom(false));
    apiSession = { user: { id: 'a1', role: 'SUPER_ADMIN' } };
    const state = await resolveMyRoomVisibilityForApi(req());
    expect(state.canView).toBe(true);
    expect(state.isPreview).toBe(true);
  });

  it('公開中は一般会員も閲覧できる', async () => {
    setStored(withMyRoom(true));
    apiSession = { user: { id: 'u1', role: 'USER' } };
    const state = await resolveMyRoomVisibilityForApi(req());
    expect(state.canView).toBe(true);
  });
});

/**
 * ★最重要★
 * ページだけ隠しても API が生きていればデータを取得できてしまう。
 * 「非表示」を名乗るなら API も塞がれていなければ意味がない。
 */
describe('requireMyRoomVisible (API ガード)', () => {
  it('非公開中の一般会員は 404 で弾かれる', async () => {
    setStored(withMyRoom(false));
    apiSession = { user: { id: 'u1', role: 'USER' } };
    await expect(requireMyRoomVisible(req())).rejects.toMatchObject({
      status: 404,
    });
  });

  it('非公開中の未ログインは 404 で弾かれる', async () => {
    setStored(withMyRoom(false));
    await expect(requireMyRoomVisible(req())).rejects.toMatchObject({
      status: 404,
    });
  });

  /** 403 だと «そこに何かある» と分かってしまうため 404 で揃える */
  it('弾くときは 403 ではなく 404 (機能の存在を隠す)', async () => {
    setStored(withMyRoom(false));
    apiSession = { user: { id: 'u1', role: 'USER' } };
    await expect(requireMyRoomVisible(req())).rejects.not.toMatchObject({
      status: 403,
    });
  });

  it('非公開中でも管理者は通り、プレビュー状態が返る', async () => {
    setStored(withMyRoom(false));
    apiSession = { user: { id: 'a1', role: 'ADMIN' } };
    const state = await requireMyRoomVisible(req());
    expect(state.canView).toBe(true);
    expect(state.isPreview).toBe(true);
  });

  it('公開中は一般会員も通る', async () => {
    setStored(withMyRoom(true));
    apiSession = { user: { id: 'u1', role: 'USER' } };
    const state = await requireMyRoomVisible(req());
    expect(state.canView).toBe(true);
    expect(state.isPreview).toBe(false);
  });

  it('設定が未保存のときも一般会員は 404 (既定は非公開)', async () => {
    setStored(null);
    apiSession = { user: { id: 'u1', role: 'USER' } };
    await expect(requireMyRoomVisible(req())).rejects.toMatchObject({
      status: 404,
    });
  });
});
