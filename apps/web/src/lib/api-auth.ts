/**
 * API リクエストの認証主体 (principal) を解決する共通ヘルパ。
 *
 * 解決順序:
 *  1. `Authorization: Bearer <token>` があれば API アクセストークンとして検証
 *     (スマホアプリ / Unity / 外部クライアント向け)。
 *  2. なければ従来どおり Auth.js の Cookie セッション (`auth()`) を参照
 *     (Web ブラウザ向け)。
 *
 * これにより、会員向け API を Web (Cookie) とネイティブアプリ (Bearer) の
 * 両方から「同じエンドポイント・同じロジック」で呼べるようになる。
 *
 * `resolveApiSession` / `requireApiSession` は Auth.js の `Session` と
 * 同じ形 (`{ user: { id, email, role, plan, capabilities } }`) を返すため、
 * 既存の Route Handler を最小差分で Bearer 対応させられる
 * (`await auth()` → `await resolveApiSession(req)`,
 *  `await requireSession()` → `await requireApiSession(req)`)。
 */
import { auth } from '@/auth';
import { errors } from '@/lib/errors';
import { verifyApiToken } from '@/lib/api-token';
import { canAccess } from '@idol/shared';
import type {
  UserRoleLiteral,
  PlanTypeLiteral,
  AdminCapabilityLiteral,
  AccessLevelLiteral,
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
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match) return match[1].trim();
  }
  // SSE (EventSource) はカスタムヘッダを送れないため、access_token クエリでも許可する
  // (待機列 / ライブ配信のリアルタイム更新など)。
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get('access_token');
    if (q) return q.trim();
  } catch {
    // req.url が相対パス等で URL 化できない場合は無視
  }
  return null;
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

/**
 * Auth.js の `Session` と同じ形 ({ user: { id, email, role, plan, capabilities } })
 * を返す互換ヘルパー。Bearer トークンでも Cookie セッションでも同じ形で受け取れるため、
 * 既存の `await auth()` / `await requireSession()` 呼び出し箇所を
 * `await resolveApiSession(req)` / `await requireApiSession(req)` に置き換えるだけで
 * モバイル (Bearer) からも呼べるようになる。
 */
export interface ApiSession {
  user: {
    id: string;
    email: string;
    role: UserRoleLiteral;
    plan: PlanTypeLiteral;
    capabilities: AdminCapabilityLiteral[];
  };
}

export async function resolveApiSession(req: Request): Promise<ApiSession | null> {
  const principal = await resolveApiPrincipal(req);
  if (!principal) return null;
  return {
    user: {
      id: principal.userId,
      email: principal.email,
      role: principal.role,
      plan: principal.plan,
      capabilities: principal.capabilities,
    },
  };
}

/** 認証必須。未認証なら 401 を throw する。 */
export async function requireApiSession(req: Request): Promise<ApiSession> {
  const session = await resolveApiSession(req);
  if (!session) throw errors.unauthorized();
  return session;
}

/** ADMIN または SUPER_ADMIN を必須にする (API用、Bearer/Cookie両対応)。 */
export async function requireApiAdmin(req: Request): Promise<ApiSession> {
  const session = await requireApiSession(req);
  if (session.user.role !== 'ADMIN' && session.user.role !== 'SUPER_ADMIN') {
    throw errors.forbidden('管理者権限が必要です');
  }
  return session;
}

/**
 * プラン(会員種別)によるアクセスレベルを必須にする (API用、Bearer/Cookie両対応)。
 *  - PUBLIC: 未ログインでも可
 *  - MEMBERS / PREMIUM: ログイン必須 + プランが足りなければ 403 (PLAN_REQUIRED)
 */
export async function requireApiAccessLevel(
  req: Request,
  level: AccessLevelLiteral,
): Promise<ApiSession | null> {
  const session = await resolveApiSession(req);
  if (level !== 'PUBLIC' && !session?.user?.id) {
    throw errors.unauthorized();
  }
  if (!canAccess(session?.user?.plan, level)) {
    throw errors.planRequired(level === 'PREMIUM' ? 'プレミアム' : 'スタンダード');
  }
  return session;
}
