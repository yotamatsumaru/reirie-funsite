/**
 * モバイル / ネイティブ (Unity 等) 向け API トークン (JWT) の発行・検証。
 *
 * Web の Cookie セッション (Auth.js) とは独立した仕組みで、Bearer トークンとして
 * `Authorization: Bearer <token>` ヘッダで送る。署名は jose (HS256) を用いる。
 *
 * - access トークン: 短命 (既定 1h)。API 呼び出しに使う。
 * - refresh トークン: 長命 (既定 30d)。access の再発行に使う ("typ":"refresh")。
 *
 * セキュリティ上の注意:
 *  - 署名鍵 (env.apiToken.secret) は本番で必ず強いランダム値を設定する。
 *  - access トークンには権限 (role/plan) を載せるが、重要操作のたびに
 *    サーバー側で最新の DB 状態を確認することを推奨 (トークンは短命にしている)。
 */
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { env } from './env';
import type {
  UserRoleLiteral,
  PlanTypeLiteral,
  AdminCapabilityLiteral,
} from '@idol/shared';

export type ApiTokenType = 'access' | 'refresh';

export interface ApiAccessClaims {
  sub: string; // userId
  email: string;
  role: UserRoleLiteral;
  plan: PlanTypeLiteral;
  capabilities: AdminCapabilityLiteral[];
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.apiToken.secret);
}

/** access トークンを発行する */
export async function signAccessToken(claims: ApiAccessClaims): Promise<string> {
  return new SignJWT({
    typ: 'access',
    email: claims.email,
    role: claims.role,
    plan: claims.plan,
    capabilities: claims.capabilities,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(env.apiToken.issuer)
    .setAudience(env.apiToken.audience)
    .setIssuedAt()
    .setExpirationTime(`${env.apiToken.accessTtlSec}s`)
    .sign(secretKey());
}

/** refresh トークンを発行する (sub のみ保持) */
export async function signRefreshToken(userId: string): Promise<string> {
  return new SignJWT({ typ: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(env.apiToken.issuer)
    .setAudience(env.apiToken.audience)
    .setIssuedAt()
    .setExpirationTime(`${env.apiToken.refreshTtlSec}s`)
    .sign(secretKey());
}

/** access + refresh をまとめて発行 */
export async function issueTokenPair(claims: ApiAccessClaims): Promise<{
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}> {
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(claims),
    signRefreshToken(claims.sub),
  ]);
  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: env.apiToken.accessTtlSec,
  };
}

type VerifiedPayload = JWTPayload & {
  typ?: string;
  email?: string;
  role?: UserRoleLiteral;
  plan?: PlanTypeLiteral;
  capabilities?: AdminCapabilityLiteral[];
};

/**
 * トークンを検証してペイロードを返す。期待する種別 (typ) を指定する。
 * 検証失敗 (署名不正 / 期限切れ / 種別不一致) は null を返す。
 */
export async function verifyApiToken(
  token: string,
  expectedType: ApiTokenType,
): Promise<VerifiedPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: env.apiToken.issuer,
      audience: env.apiToken.audience,
    });
    const p = payload as VerifiedPayload;
    if (p.typ !== expectedType) return null;
    if (!p.sub) return null;
    return p;
  } catch {
    return null;
  }
}
