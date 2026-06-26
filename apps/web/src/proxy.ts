/**
 * Next.js Proxy (旧 middleware) — Node.js runtime
 *
 *  - /me, /admin, /checkout 等の保護ルートで未ログイン (Auth.js cookie 無し) を /signin にリダイレクト
 *  - メンテナンスモード ON のとき、一般ユーザーを /maintenance にリダイレクト
 *
 * Next.js 16 から `middleware.ts` は `proxy.ts` にリネームされ、
 * runtime は固定で `nodejs` になった。これにより通常の Node API ハンドラと
 * 同じ V8 isolate で動作するため、`globalThis` (Symbol.for) を共有でき、
 * メンテナンスモードフラグを跨いで参照できる。
 *
 * 認可 (ADMIN / SUPER_ADMIN) のきめ細かいチェックは各 server component / route handler 側で実施。
 */
import { NextResponse, type NextRequest } from 'next/server';
import { isMaintenanceMode } from '@/lib/maintenance-flag';

const PROTECTED_PREFIXES = ['/me', '/admin', '/checkout'];

const SESSION_COOKIE_NAMES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

// メンテナンスモード中もアクセスを許可するパス
// (管理者用ログイン経路 + 静的アセット系)
const MAINTENANCE_BYPASS_PREFIXES = [
  '/maintenance',
  '/super-admin',
  '/admin',
  '/signin',
  '/api/auth',
  '/api/super-admin',
  // API (v1) は HTML リダイレクトではなく JSON で応答させたいのでバイパス。
  // 個々のエンドポイント側で必要なら可用性を制御する。
  '/api/v1',
];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1) メンテナンスモードチェック
  if (isMaintenanceMode()) {
    const bypass = MAINTENANCE_BYPASS_PREFIXES.some((p) => pathname.startsWith(p));
    if (!bypass) {
      return NextResponse.redirect(new URL('/maintenance', req.nextUrl.origin));
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
