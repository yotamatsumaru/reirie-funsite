/**
 * email + password による認証の共通ロジック。
 *
 * Auth.js の Credentials Provider (auth.ts) と、API トークン発行エンドポイント
 * (/api/v1/auth/token) の両方から利用し、認証ロジック
 * (パスワード検証・メール認証チェック・ブルートフォース対策のアカウントロック) を
 * 一箇所に集約する。
 *
 * 以前は auth.ts と token/route.ts で個別にロジックを持っていたため、
 * auth.ts 側にだけ追加したメール認証チェック/ログインロックアウトが
 * API トークン発行経路には適用されない抜け穴があった。この関数を両者から
 * 呼び出すことで、Web ログインと API トークン発行のセキュリティ要件を統一する。
 *
 * デモモード時は auth.ts 側と同じくパスワード検証をスキップする。
 */
import { prisma } from '@idol/db';
import { normalizeAdminCapabilities } from '@idol/shared';
import type {
  UserRoleLiteral,
  PlanTypeLiteral,
  AdminCapabilityLiteral,
} from '@idol/shared';
import { verifyPassword } from './password';
import { env } from './env';
import { logAudit } from './audit';
import { MAX_FAILED_LOGIN_ATTEMPTS, isLockedOut, lockoutExpiryDate } from './login-lockout';
import { decryptTotpSecret, verifyTotpToken, consumeBackupCode } from './totp';

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRoleLiteral;
  plan: PlanTypeLiteral;
  capabilities: AdminCapabilityLiteral[];
}

export type AuthenticateCredentialsResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; reason: 'INVALID_CREDENTIALS' }
  | { ok: false; reason: 'EMAIL_NOT_VERIFIED' }
  | { ok: false; reason: 'ACCOUNT_LOCKED' }
  // TOTP 有効な SUPER_ADMIN が totpCode 未入力でログインを試みた場合。
  // クライアント側でコード入力欄を表示するためのシグナル (パスワードは検証済み)。
  | { ok: false; reason: 'TOTP_REQUIRED' }
  // TOTP コード / バックアップコードが不正だった場合。
  | { ok: false; reason: 'TOTP_INVALID' };

/**
 * email / password (+ 必要なら TOTP コード) を検証してユーザー情報を返す。
 * 失敗時は理由 (reason) を含む結果を返すため、呼び出し側は
 * ログイン画面向け (Auth.js) / API トークン発行向け それぞれに適した
 * エラー表現へマッピングできる。
 *
 * TOTP (2段階認証) は SUPER_ADMIN 限定機能。totpEnabled なユーザーは、
 * パスワード検証後に totpCode (6桁コード or バックアップコード) の検証を追加で必須とする。
 */
export async function authenticateCredentials(
  email: string,
  password: string,
  totpCode?: string,
): Promise<AuthenticateCredentialsResult> {
  const normalizedEmail = email.trim().toLowerCase();

  // --- デモモード: パスワード検証をスキップ ---
  if (env.demoMode) {
    if (normalizedEmail === 'super@example.com' || normalizedEmail === 'superadmin@example.com') {
      return {
        ok: true,
        user: {
          id: '00000000-0000-4000-8000-000000000003',
          email: normalizedEmail,
          displayName: 'スーパー管理者',
          role: 'SUPER_ADMIN',
          plan: 'PREMIUM',
          capabilities: ['CONTENT', 'MERCH', 'GAME', 'CALL'],
        },
      };
    }
    if (normalizedEmail === 'admin@example.com') {
      return {
        ok: true,
        user: {
          id: '00000000-0000-4000-8000-000000000002',
          email: 'admin@example.com',
          displayName: 'デモ管理者',
          role: 'ADMIN',
          plan: 'PREMIUM',
          capabilities: ['CONTENT', 'MERCH', 'GAME', 'CALL'],
        },
      };
    }
    if (normalizedEmail === 'demo@example.com') {
      return {
        ok: true,
        user: {
          id: '00000000-0000-4000-8000-000000000001',
          email: 'demo@example.com',
          displayName: 'デモユーザー',
          role: 'USER',
          plan: 'PREMIUM',
          capabilities: [],
        },
      };
    }
    return {
      ok: true,
      user: {
        id: '00000000-0000-4000-8000-000000000099',
        email: normalizedEmail,
        displayName: 'ゲスト',
        role: 'USER',
        plan: 'FREE',
        capabilities: [],
      },
    };
  }

  // --- 通常モード: DB 照合 ---
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail, deletedAt: null },
    include: {
      subscriptions: {
        where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });
  if (!user) return { ok: false, reason: 'INVALID_CREDENTIALS' };

  // --- ブルートフォース対策: ロック中は早期リターン (パスワード検証は行わない) ---
  if (isLockedOut(user.lockedUntil)) {
    return { ok: false, reason: 'ACCOUNT_LOCKED' };
  }

  if (!verifyPassword(password, user.passwordHash)) {
    // 失敗回数を加算し、閾値に達したら lockedUntil を設定する。
    const failedLoginAttempts = user.failedLoginAttempts + 1;
    const shouldLock = failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: shouldLock ? 0 : failedLoginAttempts,
        lockedUntil: shouldLock ? lockoutExpiryDate() : user.lockedUntil,
      },
    });
    if (shouldLock) {
      await logAudit({
        userId: user.id,
        action: 'user.login_locked',
        metadata: { failedLoginAttempts },
      });
    }
    return { ok: false, reason: 'INVALID_CREDENTIALS' };
  }

  // ログイン成功: 失敗カウンタ/ロックが残っていればクリアする
  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  // メール認証コードを入力していないユーザーはログインできない。
  if (!user.emailVerified) {
    return { ok: false, reason: 'EMAIL_NOT_VERIFIED' };
  }

  // --- TOTP (2段階認証) チェック: SUPER_ADMIN が有効化している場合のみ必須 ---
  if (user.role === 'SUPER_ADMIN' && user.totpEnabled && user.totpSecret) {
    if (!totpCode) {
      return { ok: false, reason: 'TOTP_REQUIRED' };
    }
    const normalizedCode = totpCode.trim();
    // 6桁数字ならTOTPコードとして、それ以外はバックアップコードとして検証する。
    const isTotpFormat = /^\d{6}$/.test(normalizedCode);
    let totpOk = false;
    if (isTotpFormat) {
      const secret = decryptTotpSecret(user.totpSecret);
      totpOk = verifyTotpToken(secret, normalizedCode);
    } else {
      const { ok, remaining } = consumeBackupCode(normalizedCode, user.totpBackupCodes);
      totpOk = ok;
      if (ok) {
        // バックアップコードは使い捨てのため、消費した分をDBから取り除く。
        await prisma.user.update({
          where: { id: user.id },
          data: { totpBackupCodes: remaining },
        });
        await logAudit({
          userId: user.id,
          action: 'auth.totp_backup_code_used',
          metadata: { remainingCount: remaining.length },
        });
      }
    }
    if (!totpOk) {
      await logAudit({ userId: user.id, action: 'auth.totp_failed' });
      return { ok: false, reason: 'TOTP_INVALID' };
    }
  }

  // --- 最終ログイン日時を更新 ---
  // パスワード検証・メール認証・(必要なら) TOTP まで全て通過した後、つまり
  // 「ログインが確定した」時点で更新する。Super Admin 管理画面の
  // 「最終ログイン」表示に使用する。
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const plan: PlanTypeLiteral = user.subscriptions[0]
    ? (user.subscriptions[0].planType as PlanTypeLiteral)
    : 'FREE';

  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName ?? null,
      role: user.role as UserRoleLiteral,
      plan,
      capabilities: normalizeAdminCapabilities(user.adminCapabilities),
    },
  };
}
