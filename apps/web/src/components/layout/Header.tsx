'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useCartItemCount } from '@/stores/cart-store';
import { Badge } from '@/components/ui/Badge';

export function Header() {
  const { data: session, status } = useSession();
  const cartCount = useCartItemCount();
  const isAdmin = session?.user?.role === 'ADMIN';
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // ルート変更でメニューを閉じる
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // メニューオープン中のスクロール抑止
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4">
        {/* モバイル: ハンバーガー */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'メニューを閉じる' : 'メニューを開く'}
          aria-expanded={open}
          className="-ml-2 inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 md:hidden"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden="true"
          >
            {open ? (
              <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </>
            ) : (
              <>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            )}
          </svg>
        </button>

        <Link href="/" className="text-base font-bold text-brand-600 md:text-lg">
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

        <div className="flex items-center gap-2 text-sm md:gap-3">
          {/* モバイル: カートアイコンのみ表示 */}
          <Link
            href="/cart"
            aria-label={`カート (${cartCount}点)`}
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 md:hidden"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            {cartCount > 0 && (
              <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">
                {cartCount}
              </span>
            )}
          </Link>

          {status === 'loading' ? null : session?.user ? (
            <>
              <Link
                href="/me"
                className="hidden max-w-[160px] truncate text-slate-700 hover:text-brand-600 md:inline"
              >
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
                className="hidden text-slate-500 hover:text-rose-600 md:inline"
              >
                ログアウト
              </button>
            </>
          ) : (
            <>
              <Link
                href="/signin"
                className="hidden text-slate-700 hover:text-brand-600 md:inline"
              >
                ログイン
              </Link>
              <Link
                href="/signup"
                className="hidden rounded-md bg-brand-600 px-3 py-1.5 text-white hover:bg-brand-700 md:inline-block"
              >
                登録
              </Link>
            </>
          )}
        </div>
      </div>

      {/* モバイルドロワー */}
      <div
        className={`fixed inset-0 top-14 z-20 transition-opacity md:hidden ${
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden={!open}
      >
        {/* 背景オーバーレイ */}
        <div
          className="absolute inset-0 bg-slate-900/40"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
        {/* メニュー本体 */}
        <nav
          className={`relative flex h-[calc(100vh-3.5rem)] w-full max-w-xs flex-col gap-1 overflow-y-auto bg-white p-4 text-base shadow-xl transition-transform ${
            open ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <MobileLink href="/">ホーム</MobileLink>
          <MobileLink href="/contents">コンテンツ</MobileLink>
          <MobileLink href="/products">グッズ</MobileLink>
          <MobileLink href="/cart">
            カート{cartCount > 0 ? ` (${cartCount})` : ''}
          </MobileLink>
          {isAdmin && <MobileLink href="/admin">管理ダッシュボード</MobileLink>}

          <hr className="my-2 border-slate-200" />

          {session?.user ? (
            <>
              <MobileLink href="/me">マイページ</MobileLink>
              <p className="px-3 text-xs text-slate-500">{session.user.email}</p>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: '/' })}
                className="mt-2 rounded-md px-3 py-3 text-left text-rose-600 hover:bg-rose-50"
              >
                ログアウト
              </button>
            </>
          ) : (
            <>
              <MobileLink href="/signin">ログイン</MobileLink>
              <Link
                href="/signup"
                className="mt-2 block rounded-md bg-brand-600 px-3 py-3 text-center font-semibold text-white hover:bg-brand-700"
              >
                新規会員登録
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function MobileLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-3 font-medium text-slate-700 hover:bg-slate-100"
    >
      {children}
    </Link>
  );
}
