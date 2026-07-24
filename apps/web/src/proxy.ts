/**
 * Next.js Proxy (旧 middleware) — Node.js runtime
 *
 *  - /me, /admin, /checkout 等の保護ルートで未ログイン (Auth.js cookie 無し) を /signin にリダイレクト
 *  - メンテナンスモード ON のとき、【スーパー管理者以外の】すべての訪問者を
 *    /maintenance にリダイレクト (API は 503 JSON)。スーパー管理者だけは通常どおり
 *    全ページ・API を利用できるため、メンテ中の動作確認・設定変更が可能。
 *
 * Next.js 16 から `middleware.ts` は `proxy.ts` にリネームされ、runtime は固定で
 * `nodejs` になった。Node runtime なので Prisma / next-auth の getToken を利用でき、
 * 永続 AppSetting (site.maintenance) と JWT の role を直接参照して制御する。
 *
 * 認可 (ADMIN / SUPER_ADMIN) のきめ細かいチェックは各 server component / route handler 側でも実施。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { isMaintenanceModeAsync } from '@/lib/maintenance-flag';

const PROTECTED_PREFIXES = ['/me', '/admin', '/checkout'];

const SESSION_COOKIE_NAMES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

/**
 * メンテナンスモード中でも role 判定より前に無条件で通すパス。
 *  - /maintenance : メンテ案内ページ自体 (無限リダイレクト防止)
 *  - /signin, /api/auth : スーパー管理者がログインするための経路
 *  - 静的アセット系はページ表示に必要
 * ※ ここには /admin や /super-admin を含めない。
 *   「スーパー管理者以外は閲覧不可」を満たすため、role で判定する。
 */
const MAINTENANCE_ALWAYS_ALLOW_PREFIXES = ['/maintenance', '/signin', '/api/auth'];

async function isSuperAdmin(req: NextRequest): Promise<boolean> {
  try {
    const token = await getToken({
      req,
      secret: process.env.AUTH_SECRET ?? 'dev-insecure-secret-change-me',
      secureCookie: process.env.NODE_ENV === 'production',
    });
    return (token as { role?: string } | null)?.role === 'SUPER_ADMIN';
  } catch {
    return false;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1) メンテナンスモードチェック (永続 AppSetting + 短時間キャッシュ)
  if (await isMaintenanceModeAsync()) {
    const alwaysAllow = MAINTENANCE_ALWAYS_ALLOW_PREFIXES.some((p) =>
      pathname.startsWith(p),
    );
    if (!alwaysAllow) {
      // スーパー管理者だけは通常どおり閲覧・操作できる
      if (!(await isSuperAdmin(req))) {
        // API は JSON 503、ページ遷移は /maintenance へ
        if (pathname.startsWith('/api/')) {
          return NextResponse.json(
            {
              error: {
                code: 'MAINTENANCE',
                message: 'ただいまメンテナンス中です。しばらくお待ちください。',
              },
            },
            { status: 503, headers: { 'Retry-After': '3600' } },
          );
        }
        return NextResponse.redirect(new URL('/maintenance', req.nextUrl.origin));
      }
    }
  }

  // 2) 認証ガード
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  const hasSession = SESSION_COOKIE_NAMES.some((name) => req.cookies.get(name)?.value);
  if (!hasSession) {
    const signinUrl = new URL('/signin', req.nextUrl.origin);
    signinUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(signinUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
