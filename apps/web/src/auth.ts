/**
 * Auth.js v5 (NextAuth) 設定
 *
 * - Credentials Provider (email + password) を使用
 * - JWT セッション戦略 (Edge middleware から参照可能にするため)
 * - DB アダプタは付けず、自前 users テーブルでパスワード認証
 *   (Account/Session テーブルはOAuth拡張時に備えて Prisma スキーマに残置)
 */
import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { prisma } from '@idol/db';
import { verifyPassword } from './lib/password';
import { canAccess, type AccessLevelLiteral, type PlanTypeLiteral } from '@idol/shared';
import { env } from './lib/env';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      role: 'USER' | 'ADMIN';
      plan: PlanTypeLiteral;
    } & DefaultSession['user'];
  }
  interface User {
    id?: string;
    role?: 'USER' | 'ADMIN';
    plan?: PlanTypeLiteral;
  }
}

/**
 * JWT shape — Auth.js v5 + next-auth では型拡張がツールチェーンによって
 * 解決できないことがあるため、ここでは内部 helper 型として定義し、
 * callback で `token as unknown as AppJWT` でキャストする。
 */
interface AppJWT {
  userId: string;
  role: 'USER' | 'ADMIN';
  plan: PlanTypeLiteral;
  planRefreshedAt?: number;
}

const CredentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const { handlers, signIn, signOut, auth } = NextAuth({
  // ↑ handlers をそのままexport ( app/api/auth/[...nextauth]/route.ts で再エクスポート)
  secret: env.auth.secret,
  trustHost: env.auth.trustHost || !env.isProduction,
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 },
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
      },
      authorize: async (raw) => {
        const parsed = CredentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        // --- デモモード: パスワード検証をスキップしてログイン可能にする ---
        if (env.demoMode) {
          const email = parsed.data.email.toLowerCase();
          // demo@example.com (PREMIUM) と admin@example.com (ADMIN) を許可
          // それ以外は STANDARD ゲストとしてログイン許可
          if (email === 'admin@example.com') {
            return {
              id: '00000000-0000-4000-8000-000000000002',
              email: 'admin@example.com',
              name: 'デモ管理者',
              role: 'ADMIN',
              plan: 'PREMIUM' as PlanTypeLiteral,
            };
          }
          if (email === 'demo@example.com') {
            return {
              id: '00000000-0000-4000-8000-000000000001',
              email: 'demo@example.com',
              name: 'デモユーザー',
              role: 'USER',
              plan: 'PREMIUM' as PlanTypeLiteral,
            };
          }
          // 任意メールでも閲覧できるようゲスト扱いで通す
          return {
            id: '00000000-0000-4000-8000-000000000099',
            email: parsed.data.email,
            name: 'ゲスト',
            role: 'USER',
            plan: 'FREE' as PlanTypeLiteral,
          };
        }

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email, deletedAt: null },
          include: {
            subscriptions: {
              where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        });
        if (!user) return null;
        if (!verifyPassword(parsed.data.password, user.passwordHash)) return null;

        const plan: PlanTypeLiteral = user.subscriptions[0]
          ? (user.subscriptions[0].planType as PlanTypeLiteral)
          : 'FREE';

        return {
          id: user.id,
          email: user.email,
          name: user.displayName ?? null,
          role: user.role,
          plan,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      const t = token as unknown as AppJWT & Record<string, unknown>;
      if (user) {
        t.userId = user.id as string;
        t.role = (user.role ?? 'USER') as 'USER' | 'ADMIN';
        t.plan = (user.plan ?? 'FREE') as PlanTypeLiteral;
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
          t.role = u.role as 'USER' | 'ADMIN';
          t.plan = (u.subscriptions[0]?.planType as PlanTypeLiteral) ?? 'FREE';
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
  if (session.user.role !== 'ADMIN') {
    const { errors } = await import('./lib/errors');
    throw errors.forbidden('管理者権限が必要です');
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
