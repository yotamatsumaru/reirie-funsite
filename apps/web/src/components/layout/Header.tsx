'use client';

import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { useCartItemCount } from '@/stores/cart-store';
import { Badge } from '@/components/ui/Badge';

export function Header() {
  const { data: session, status } = useSession();
  const cartCount = useCartItemCount();
  const isAdmin = session?.user?.role === 'ADMIN';

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="text-lg font-bold text-brand-600">
          IDOL FAN
        </Link>

        <nav className="hidden items-center gap-6 text-sm font-medium text-slate-700 md:flex">
          <Link href="/contents" className="hover:text-brand-600">
            コンテンツ
          </Link>
          <Link href="/products" className="hover:text-brand-600">
            グッズ
          </Link>
          <Link href="/cart" className="relative hover:text-brand-600">
            カート
            {cartCount > 0 && (
              <span className="absolute -right-3 -top-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">
                {cartCount}
              </span>
            )}
          </Link>
          {isAdmin && (
            <Link href="/admin" className="text-slate-500 hover:text-brand-600">
              管理
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-3 text-sm">
          {status === 'loading' ? null : session?.user ? (
            <>
              <Link href="/me" className="hidden text-slate-700 hover:text-brand-600 md:inline">
                {session.user.email}
              </Link>
              {session.user.plan && session.user.plan !== 'FREE' && (
                <Badge tone={session.user.plan === 'PREMIUM' ? 'brand' : 'info'}>
                  {session.user.plan}
                </Badge>
              )}
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: '/' })}
                className="text-slate-500 hover:text-rose-600"
              >
                ログアウト
              </button>
            </>
          ) : (
            <>
              <Link href="/signin" className="text-slate-700 hover:text-brand-600">
                ログイン
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-brand-600 px-3 py-1.5 text-white hover:bg-brand-700"
              >
                登録
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
