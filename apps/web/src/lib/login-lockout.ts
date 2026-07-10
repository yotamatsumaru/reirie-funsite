/**
 * ログイン試行のブルートフォース対策 (アカウントロック方式)
 *
 * - 連続で MAX_FAILED_LOGIN_ATTEMPTS 回ログインに失敗すると、
 *   LOCKOUT_DURATION_MINUTES 分の間ログインをブロックする。
 * - PM2 cluster モード (複数プロセス) で動作するため、状態は
 *   in-memory ではなく DB (users.failed_login_attempts / locked_until) に保持する。
 * - ロック中でもパスワードは検証しない (タイミング差での列挙を避けるため早期リターン)。
 */

export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MINUTES = 15;

/** ロック解除時刻 (現在時刻 + LOCKOUT_DURATION_MINUTES 分) を返す */
export function lockoutExpiryDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + LOCKOUT_DURATION_MINUTES * 60 * 1000);
}

/** ロック中かどうか (lockedUntil が未来かどうか) を判定する */
export function isLockedOut(lockedUntil: Date | null | undefined, now: Date = new Date()): boolean {
  return !!lockedUntil && lockedUntil.getTime() > now.getTime();
}

/** ロック解除までの残り秒数 (ロックされていない場合は 0) */
export function lockoutRemainingSeconds(
  lockedUntil: Date | null | undefined,
  now: Date = new Date(),
): number {
  if (!isLockedOut(lockedUntil, now)) return 0;
  return Math.max(0, Math.ceil((lockedUntil!.getTime() - now.getTime()) / 1000));
}
