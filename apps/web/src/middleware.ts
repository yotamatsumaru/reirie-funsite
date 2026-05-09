/**
 * Next.js Middleware (Edge)
 *  - /me, /admin, /checkout 等の保護ルートで未ログインを /signin にリダイレクト
 *  - Auth.js v5 の auth() を直接呼ぶ
 */
import { auth } from './auth';
import { NextResponse } from 'next/server';

const PROTECTED_PREFIXES = ['/me', '/admin', '/checkout'];
const ADMIN_PREFIX = '/admin';

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  if (!req.auth?.user?.id) {
    const signinUrl = new URL('/signin', req.nextUrl.origin);
    signinUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(signinUrl);
  }
  if (pathname.startsWith(ADMIN_PREFIX) && req.auth.user.role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/', req.nextUrl.origin));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
