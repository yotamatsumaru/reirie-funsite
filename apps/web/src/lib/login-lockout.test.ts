import {
  MAX_FAILED_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_MINUTES,
  lockoutExpiryDate,
  isLockedOut,
  lockoutRemainingSeconds,
} from './login-lockout';

describe('login-lockout', () => {
  it('constants はブルートフォース対策として妥当な値である', () => {
    expect(MAX_FAILED_LOGIN_ATTEMPTS).toBeGreaterThanOrEqual(3);
    expect(LOCKOUT_DURATION_MINUTES).toBeGreaterThan(0);
  });

  it('lockoutExpiryDate は指定時刻から LOCKOUT_DURATION_MINUTES 分後を返す', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const expiry = lockoutExpiryDate(from);
    expect(expiry.getTime() - from.getTime()).toBe(LOCKOUT_DURATION_MINUTES * 60 * 1000);
  });

  describe('isLockedOut', () => {
    it('lockedUntil が null/undefined の場合は false', () => {
      expect(isLockedOut(null)).toBe(false);
      expect(isLockedOut(undefined)).toBe(false);
    });

    it('lockedUntil が未来の場合は true', () => {
      const now = new Date('2026-01-01T00:00:00Z');
      const future = new Date('2026-01-01T00:10:00Z');
      expect(isLockedOut(future, now)).toBe(true);
    });

    it('lockedUntil が過去の場合は false', () => {
      const now = new Date('2026-01-01T00:10:00Z');
      const past = new Date('2026-01-01T00:00:00Z');
      expect(isLockedOut(past, now)).toBe(false);
    });
  });

  describe('lockoutRemainingSeconds', () => {
    it('ロックされていない場合は 0', () => {
      expect(lockoutRemainingSeconds(null)).toBe(0);
    });

    it('ロック中は残り秒数を返す', () => {
      const now = new Date('2026-01-01T00:00:00Z');
      const future = new Date('2026-01-01T00:00:30Z');
      expect(lockoutRemainingSeconds(future, now)).toBe(30);
    });
  });
});
