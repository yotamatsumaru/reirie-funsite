const findUnique = jest.fn();
jest.mock('@idol/db', () => ({ prisma: { user: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));

import {
  ACCOUNT_STATUS_CACHE_MS,
  forgetAccountStatus,
  isAccountActiveCached,
  isActiveAccount,
} from './account-status';

describe('isActiveAccount', () => {
  it('deletedAt が無いユーザーだけ有効', () => {
    expect(isActiveAccount({ deletedAt: null })).toBe(true);
    expect(isActiveAccount({ deletedAt: new Date() })).toBe(false); // BAN / 退会
    expect(isActiveAccount(null)).toBe(false); // 物理削除済み
    expect(isActiveAccount(undefined)).toBe(false);
  });
});

describe('isAccountActiveCached (アプリの Bearer 用)', () => {
  beforeEach(() => findUnique.mockReset());

  it('BAN されたユーザーは拒否される', async () => {
    findUnique.mockResolvedValue({ deletedAt: new Date() });
    expect(await isAccountActiveCached('banned-1', 0)).toBe(false);
  });

  it('1 分間はキャッシュし、過ぎたら DB を見直す', async () => {
    findUnique.mockResolvedValue({ deletedAt: null });
    expect(await isAccountActiveCached('u-1', 0)).toBe(true);
    findUnique.mockResolvedValue({ deletedAt: new Date() });
    expect(await isAccountActiveCached('u-1', ACCOUNT_STATUS_CACHE_MS - 1)).toBe(true);
    expect(await isAccountActiveCached('u-1', ACCOUNT_STATUS_CACHE_MS + 1)).toBe(false);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('forgetAccountStatus でキャッシュを待たずに反映される', async () => {
    findUnique.mockResolvedValue({ deletedAt: null });
    expect(await isAccountActiveCached('u-2', 0)).toBe(true);
    findUnique.mockResolvedValue({ deletedAt: new Date() });
    forgetAccountStatus('u-2');
    expect(await isAccountActiveCached('u-2', 1)).toBe(false);
  });
});
