/**
 * Auth.js v5 (NextAuth) 設定
 *
 * - Credentials Provider (email + password) を使用
 * - JWT セッション戦略 (Edge middleware から参照可能にするため)
 * - DB アダプタは付けず、自前 users テーブルでパスワード認証
 *   (Account/Session テーブルはOAuth拡張時に備えて Prisma スキーマに残置)
 */
import NextAuth, { type DefaultSession } from 'next-auth';
import { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { prisma } from '@idol/db';
import {
  canAccess,
  hasCapability,
  normalizeAdminCapabilities,
  type AccessLevelLiteral,
  type AdminCapabilityLiteral,
  type PlanTypeLiteral,
  type UserRoleLiteral,
} from '@idol/shared';
import { env } from './lib/env';
import { authenticateCredentials } from './lib/credentials';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      role: UserRoleLiteral;
      plan: PlanTypeLiteral;
      capabilities: AdminCapabilityLiteral[];
    } & DefaultSession['user'];
  }
  interface User {
    id?: string;
    role?: UserRoleLiteral;
    plan?: PlanTypeLiteral;
    capabilities?: AdminCapabilityLiteral[];
  }
}

/**
 * JWT shape — Auth.js v5 + next-auth では型拡張がツールチェーンによって
 * 解決できないことがあるため、ここでは内部 helper 型として定義し、
 * callback で `token as unknown as AppJWT` でキャストする。
 */
interface AppJWT {
  userId: string;
  role: UserRoleLiteral;
  plan: PlanTypeLiteral;
  capabilities: AdminCapabilityLiteral[];
  planRefreshedAt?: number;
}

const CredentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
  // TOTP (Google Authenticator) 2段階認証コード。SUPER_ADMIN が有効化している場合のみ必須。
  totpCode: z.string().min(1).optional(),
});

/** メール未認証でログインを試みた場合に、クライアントへ区別可能なエラーコードを渡す */
class EmailNotVerifiedError extends CredentialsSignin {
  code = 'EMAIL_NOT_VERIFIED';
}

/** ブルートフォース対策でアカウントが一時ロックされている場合に返すエラー */
class AccountLockedError extends CredentialsSignin {
  code = 'ACCOUNT_LOCKED';
}

/** TOTP 有効な SUPER_ADMIN が totpCode 未入力でログインを試みた場合 (パスワードは検証済み) */
class TotpRequiredError extends CredentialsSignin {
  code = 'TOTP_REQUIRED';
}

/** TOTP コード / バックアップコードが不正だった場合 */
class TotpInvalidError extends CredentialsSignin {
  code = 'TOTP_INVALID';
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  // ↑ handlers をそのままexport ( app/api/auth/[...nextauth]/route.ts で再エクスポート)
  secret: env.auth.secret,
  trustHost: env.auth.trustHost || !env.isProduction,
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 },
  // 本番環境では常に secure cookie (__Secure-/__Host- プレフィックス + Secure 属性) を強制する。
  // EC2 + nginx (TLS終端) 構成のため、リクエストプロトコル自動判定に依存せず明示指定することで、
  // 万が一 X-Forwarded-Proto の伝搬に問題があっても Cookie が平文 HTTP へ漏れることを防ぐ。
  // CSRF トークンも __Host- cookie (Secure + SameSite=lax + パス固定) で保護される (Auth.js標準)。
  useSecureCookies: env.isProduction,
  pages: {
    signIn: '/signin',
    error: '/signin',
  },
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        email: { label: 'メールアドレス', type: 'email' },
        password: { label: 'パスワード', type: 'password' },
        totpCode: { label: '2段階認証コード', type: 'text' },
      },
      authorize: async (raw) => {
        const parsed = CredentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        // --- デモモード: パスワード検証をスキップしてログイン可能にする ---
        if (env.demoMode) {
          const email = parsed.data.email.toLowerCase();
          // メールごとに権限を割り当て (デモ用)
          if (email === 'super@example.com' || email === 'superadmin@example.com') {
            return {
              id: '00000000-0000-4000-8000-000000000003',
              email,
              name: 'スーパー管理者',
              role: 'SUPER_ADMIN' as UserRoleLiteral,
              plan: 'PREMIUM' as PlanTypeLiteral,
              capabilities: ['CONTENT', 'MERCH', 'GAME', 'CALL'] as AdminCapabilityLiteral[],
            };
          }
          if (email === 'admin@example.com') {
            return {
              id: '00000000-0000-4000-8000-000000000002',
              email: 'admin@example.com',
              name: 'デモ管理者',
              role: 'ADMIN' as UserRoleLiteral,
              plan: 'PREMIUM' as PlanTypeLiteral,
              capabilities: ['CONTENT', 'MERCH', 'GAME', 'CALL'] as AdminCapabilityLiteral[],
            };
          }
          if (email === 'demo@example.com') {
            return {
              id: '00000000-0000-4000-8000-000000000001',
              email: 'demo@example.com',
              name: 'デモユーザー',
              role: 'USER' as UserRoleLiteral,
              plan: 'PREMIUM' as PlanTypeLiteral,
            };
          }
          // 任意メールでも閲覧できるようゲスト扱いで通す
          return {
            id: '00000000-0000-4000-8000-000000000099',
            email: parsed.data.email,
            name: 'ゲスト',
            role: 'USER' as UserRoleLiteral,
            plan: 'FREE' as PlanTypeLiteral,
          };
        }

        // 認証ロジック (パスワード検証・メール認証チェック・ログインロックアウト・TOTP) は
        // /api/v1/auth/token (モバイル/API向け) と共通化されている (lib/credentials.ts)。
        const result = await authenticateCredentials(
          parsed.data.email,
          parsed.data.password,
          parsed.data.totpCode,
        );
        if (!result.ok) {
          if (result.reason === 'ACCOUNT_LOCKED') throw new AccountLockedError();
          if (result.reason === 'EMAIL_NOT_VERIFIED') throw new EmailNotVerifiedError();
          if (result.reason === 'TOTP_REQUIRED') throw new TotpRequiredError();
          if (result.reason === 'TOTP_INVALID') throw new TotpInvalidError();
          return null;
        }

        return {
          id: result.user.id,
          email: result.user.email,
          name: result.user.displayName ?? null,
          role: result.user.role,
          plan: result.user.plan,
          capabilities: result.user.capabilities,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      const t = token as unknown as AppJWT & Record<string, unknown>;
      if (user) {
        t.userId = user.id as string;
        t.role = (user.role ?? 'USER') as UserRoleLiteral;
        t.plan = (user.plan ?? 'FREE') as PlanTypeLiteral;
        t.capabilities = normalizeAdminCapabilities(user.capabilities);
        t.planRefreshedAt = Date.now();
      }
      // デモモードでは DB アクセスせずトークン値をそのまま使う
      if (env.demoMode) {
        return token;
      }
      // 5分以上経過 or "update" トリガで plan を再取得
      const stale =
        !t.planRefreshedAt || Date.now() - (t.planRefreshedAt ?? 0) > 5 * 60 * 1000;
      if (t.userId && (trigger === 'update' || stale)) {
        const u = await prisma.user.findUnique({
          where: { id: t.userId },
          include: {
            subscriptions: {
              where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        });
        if (u) {
          t.role = u.role as UserRoleLiteral;
          t.plan = (u.subscriptions[0]?.planType as PlanTypeLiteral) ?? 'FREE';
          t.capabilities = normalizeAdminCapabilities(u.adminCapabilities);
          t.planRefreshedAt = Date.now();
        }
      }
      return token;
    },
    async session({ session, token }) {
      const t = token as unknown as AppJWT;
      if (t.userId && session.user) {
        session.user.id = t.userId;
        session.user.role = t.role;
        session.user.plan = t.plan;
        session.user.capabilities = normalizeAdminCapabilities(t.capabilities);
      }
      return session;
    },
  },
});

/**
 * Route Handler / Server Component で使う認証必須ヘルパ
 */
export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) {
    const { errors } = await import('./lib/errors');
    throw errors.unauthorized();
  }
  return session;
}

export async function requireAdmin() {
  const session = await requireSession();
  // ADMIN または SUPER_ADMIN を許可
  if (session.user.role !== 'ADMIN' && session.user.role !== 'SUPER_ADMIN') {
    const { errors } = await import('./lib/errors');
    throw errors.forbidden('管理者権限が必要です');
  }
  return session;
}

/**
 * 領域別の管理権限 (Admin Capability) を必須にする (API用)。
 *  - SUPER_ADMIN は常に許可
 *  - ADMIN は対象 capability を保持していれば許可
 *  - それ以外は 403
 */
export async function requireCapability(required: AdminCapabilityLiteral) {
  const session = await requireSession();
  const ok = hasCapability(
    { role: session.user.role, capabilities: session.user.capabilities },
    required,
  );
  if (!ok) {
    const { errors } = await import('./lib/errors');
    const { ADMIN_CAPABILITY_LABELS } = await import('@idol/shared');
    throw errors.forbidden(`「${ADMIN_CAPABILITY_LABELS[required]}」の管理権限が必要です`);
  }
  return session;
}

/**
 * Server Component (ページ) 用の管理権限ガード。
 *  - 未ログイン → /signin
 *  - 権限なし → /admin (ダッシュボード)。ダッシュボードにも入れない場合は /
 */
export async function requireCapabilityPage(required: AdminCapabilityLiteral) {
  const session = await auth();
  const { redirect } = await import('next/navigation');
  if (!session?.user?.id) {
    redirect('/signin?callbackUrl=/admin');
    throw new Error('unreachable');
  }
  const principal = {
    role: session.user.role,
    capabilities: session.user.capabilities,
  };
  if (!hasCapability(principal, required)) {
    redirect('/admin');
    throw new Error('unreachable');
  }
  return session;
}

/**
 * SUPER_ADMIN (システム最高権限) 必須
 *  - KPI 閲覧 / ユーザー BAN / 管理者ロール付与剥奪 / 監査ログ閲覧 / 強制返金 などに利用
 *  - ADMIN ではアクセスできない (権限境界を明確化)
 */
export async function requireSuperAdmin() {
  const session = await requireSession();
  if (session.user.role !== 'SUPER_ADMIN') {
    const { errors } = await import('./lib/errors');
    throw errors.forbidden('スーパー管理者権限が必要です');
  }
  return session;
}

/**
 * スーパー管理画面の「閲覧」を許可するガード (SUPER_ADMIN または STAFF)。
 *  - 読み取り専用のページ / GET API に利用する。
 *  - 返金 / BAN / ロール変更などの書き込み操作は必ず requireSuperAdmin() を使い、
 *    STAFF を拒否すること。
 */
export async function requireSuperAdminView() {
  const session = await requireSession();
  if (session.user.role !== 'SUPER_ADMIN' && session.user.role !== 'STAFF') {
    const { errors } = await import('./lib/errors');
    throw errors.forbidden('スーパー管理者権限が必要です');
  }
  return session;
}

export async function requireAccessLevel(level: AccessLevelLiteral) {
  const session = await auth();
  if (level !== 'PUBLIC' && !session?.user?.id) {
    const { errors } = await import('./lib/errors');
    throw errors.unauthorized();
  }
  if (!canAccess(session?.user?.plan, level)) {
    const { errors } = await import('./lib/errors');
    throw errors.planRequired(level === 'PREMIUM' ? 'プレミアム' : 'スタンダード');
  }
  return session;
}
