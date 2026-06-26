/**
 * email + password による認証の共通ロジック。
 *
 * Auth.js の Credentials Provider (auth.ts) と、API トークン発行エンドポイント
 * (/api/v1/auth/token) の両方から利用し、認証ロジックを一箇所に集約する。
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

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRoleLiteral;
  plan: PlanTypeLiteral;
  capabilities: AdminCapabilityLiteral[];
}

/**
 * email / password を検証してユーザー情報を返す。失敗時は null。
 */
export async function authenticateCredentials(
  email: string,
  password: string,
): Promise<AuthenticatedUser | null> {
  const normalizedEmail = email.trim().toLowerCase();

  // --- デモモード: パスワード検証をスキップ ---
  if (env.demoMode) {
    if (normalizedEmail === 'super@example.com' || normalizedEmail === 'superadmin@example.com') {
      return {
        id: '00000000-0000-4000-8000-000000000003',
        email: normalizedEmail,
        displayName: 'スーパー管理者',
        role: 'SUPER_ADMIN',
        plan: 'PREMIUM',
        capabilities: ['CONTENT', 'MERCH', 'GAME', 'CALL'],
      };
    }
    if (normalizedEmail === 'admin@example.com') {
      return {
        id: '00000000-0000-4000-8000-000000000002',
        email: 'admin@example.com',
        displayName: 'デモ管理者',
        role: 'ADMIN',
        plan: 'PREMIUM',
        capabilities: ['CONTENT', 'MERCH', 'GAME', 'CALL'],
      };
    }
    if (normalizedEmail === 'demo@example.com') {
      return {
        id: '00000000-0000-4000-8000-000000000001',
        email: 'demo@example.com',
        displayName: 'デモユーザー',
        role: 'USER',
        plan: 'PREMIUM',
        capabilities: [],
      };
    }
    return {
      id: '00000000-0000-4000-8000-000000000099',
      email: normalizedEmail,
      displayName: 'ゲスト',
      role: 'USER',
      plan: 'FREE',
      capabilities: [],
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
  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;

  const plan: PlanTypeLiteral = user.subscriptions[0]
    ? (user.subscriptions[0].planType as PlanTypeLiteral)
    : 'FREE';

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName ?? null,
    role: user.role as UserRoleLiteral,
    plan,
    capabilities: normalizeAdminCapabilities(user.adminCapabilities),
  };
}
