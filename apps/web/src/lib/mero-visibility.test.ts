/**
 * Mero の公開 / 非公開ゲート (lib/mero-visibility.ts) のテスト。
 *
 * 守っている仕様:
 *  1. 設定が未保存 (= 既定) なら非公開。一般会員・未ログインは API で 404
 *  2. 非公開中でも管理者はプレビューでき、isPreview が立つ (非公開中バナー用)
 *  3. 公開すれば一般会員も見られる
 */
let appSettingRows: Record<string, string> = {};
let apiSession: { user: { id: string; role: string } } | null = null;
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
jest.mock('@/auth', () => ({ auth: () => Promise.resolve(cookieSession) }));
jest.mock('@/lib/api-auth', () => ({ resolveApiSession: () => Promise.resolve(apiSession) }));

import { resolveMeroVisibility, requireMeroVisible } from './mero-visibility';
import { DEFAULT_SITE_SECTION_VISIBILITY } from '@idol/shared';

const setMero = (visible: boolean | null) => {
  if (visible === null) delete appSettingRows['site.sectionVisibility'];
  else
    appSettingRows['site.sectionVisibility'] = JSON.stringify({
      ...DEFAULT_SITE_SECTION_VISIBILITY,
      meroVisible: visible,
    });
};
const req = () => new Request('http://localhost/api/me/mero');

beforeEach(() => {
  appSettingRows = {};
  apiSession = null;
  cookieSession = null;
});

describe('requireMeroVisible (API ガード)', () => {
  it('設定が未保存なら非公開: 未ログインは 404', async () => {
    setMero(null);
    await expect(requireMeroVisible(req())).rejects.toMatchObject({ status: 404 });
  });

  it('非公開中の一般会員 (USER) は 404', async () => {
    setMero(false);
    apiSession = { user: { id: 'u1', role: 'USER' } };
    await expect(requireMeroVisible(req())).rejects.toMatchObject({ status: 404 });
  });

  it.each(['STAFF', 'ADMIN', 'SUPER_ADMIN'])('非公開中でも %s は通る (プレビュー)', async (role) => {
    setMero(false);
    apiSession = { user: { id: 'a1', role } };
    await expect(requireMeroVisible(req())).resolves.toMatchObject({
      canView: true,
      isPreview: true,
    });
  });

  it('公開すれば一般会員も通り、プレビュー扱いにならない', async () => {
    setMero(true);
    apiSession = { user: { id: 'u1', role: 'USER' } };
    await expect(requireMeroVisible(req())).resolves.toMatchObject({
      canView: true,
      isPreview: false,
    });
  });
});

describe('resolveMeroVisibility (ページ用)', () => {
  it('非公開中の一般会員は閲覧不可 / バナーも出さない', async () => {
    setMero(false);
    cookieSession = { user: { id: 'u1', role: 'USER' } };
    expect(await resolveMeroVisibility()).toEqual({
      meroVisible: false,
      canView: false,
      isPreview: false,
    });
  });

  it('壊れた設定値でも例外にせず非公開として扱う', async () => {
    appSettingRows['site.sectionVisibility'] = '{ broken';
    cookieSession = { user: { id: 'u1', role: 'USER' } };
    expect((await resolveMeroVisibility()).canView).toBe(false);
  });
});
