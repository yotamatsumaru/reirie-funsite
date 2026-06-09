/**
 * Next.js Middleware (Edge)
 *  - /me, /admin, /checkout 等の保護ルートで未ログイン (Auth.js cookie 無し) を /signin にリダイレクト
 *
 * Note: Auth.js v5 の `auth()` ラッパは node:crypto (scrypt) を transit する関係で
 * Edge Runtime と相性が悪いため、middleware では JWT セッション cookie の有無のみで簡易判定する。
 * 役割 (ADMIN) チェック等のきめ細かい認可は各 server component / route handler 側で実施。
 */
import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED_PREFIXES = ['/me', '/admin', '/checkout'];

const SESSION_COOKIE_NAMES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
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
