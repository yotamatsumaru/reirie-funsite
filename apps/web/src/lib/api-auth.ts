/**
 * API リクエストの認証主体 (principal) を解決する共通ヘルパ。
 *
 * 解決順序:
 *  1. `Authorization: Bearer <token>` があれば API アクセストークンとして検証
 *     (Unity / モバイル / 外部クライアント向け)。
 *  2. なければ従来どおり Auth.js の Cookie セッション (`auth()`) を参照
 *     (Web ブラウザ向け)。
 *
 * これにより、ゲーム等の API を Web (Cookie) とネイティブ (Bearer) の
 * 両方から「同じエンドポイント・同じロジック」で呼べるようになる。
 */
import { auth } from '@/auth';
import { errors } from '@/lib/errors';
import { verifyApiToken } from '@/lib/api-token';
import type {
  UserRoleLiteral,
  PlanTypeLiteral,
  AdminCapabilityLiteral,
} from '@idol/shared';

export type AuthSource = 'bearer' | 'cookie';

export interface ApiPrincipal {
  userId: string;
  email: string;
  role: UserRoleLiteral;
  plan: PlanTypeLiteral;
  capabilities: AdminCapabilityLiteral[];
  /** どの方式で認証されたか (監査・分岐用) */
  source: AuthSource;
}

function extractBearer(req: Request): string | null {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * リクエストから認証主体を解決する。未認証なら null。
 * Bearer を優先し、無ければ Cookie セッションにフォールバックする。
 */
export async function resolveApiPrincipal(req: Request): Promise<ApiPrincipal | null> {
  // 1) Bearer トークン
  const bearer = extractBearer(req);
  if (bearer) {
    const payload = await verifyApiToken(bearer, 'access');
    if (!payload?.sub) return null; // トークンが付いているのに無効 → 認証失敗扱い
    return {
      userId: payload.sub,
      email: payload.email ?? '',
      role: (payload.role ?? 'USER') as UserRoleLiteral,
      plan: (payload.plan ?? 'FREE') as PlanTypeLiteral,
      capabilities: (payload.capabilities ?? []) as AdminCapabilityLiteral[],
      source: 'bearer',
    };
  }

  // 2) Cookie セッション
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    userId: session.user.id,
    email: session.user.email,
    role: session.user.role,
    plan: session.user.plan,
    capabilities: session.user.capabilities ?? [],
    source: 'cookie',
  };
}

/**
 * 認証必須。未認証なら 401 を throw する (handle でラップされる前提)。
 */
export async function requireApiPrincipal(req: Request): Promise<ApiPrincipal> {
  const principal = await resolveApiPrincipal(req);
  if (!principal) {
    throw errors.unauthorized();
  }
  return principal;
}
