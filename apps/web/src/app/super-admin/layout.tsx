/**
 * /super-admin レイアウト
 *
 * - SUPER_ADMIN 専用 (ADMIN は /admin に誘導)
 * - サイドナビ + モバイル横スクロールタブ
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/super-admin', label: 'ダッシュボード', icon: '📊' },
  { href: '/super-admin/users', label: 'ユーザー', icon: '👥' },
  { href: '/super-admin/subscriptions', label: 'サブスク', icon: '💳' },
  { href: '/super-admin/audit', label: '監査ログ', icon: '📜' },
  { href: '/super-admin/admins', label: '管理者', icon: '🛡️' },
];

export default async function SuperAdminLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/super-admin');
  if (session.user.role !== 'SUPER_ADMIN') redirect('/');

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-slate-50">
      {/* SUPER_ADMIN バナー */}
      <div className="border-b border-rose-200 bg-gradient-to-r from-rose-50 via-pink-50 to-rose-50 px-3 py-2 sm:px-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 text-xs">
          <p className="flex items-center gap-2 font-semibold text-rose-800">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-white">
              ⚡
            </span>
            SUPER ADMIN モード
          </p>
          <p className="hidden text-rose-700 sm:block">
            {session.user.email} としてログイン中
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-6 lg:flex lg:gap-6">
        {/* モバイル: 横スクロールタブ */}
        <nav className="-mx-3 mb-4 flex gap-1 overflow-x-auto px-3 pb-2 text-sm lg:hidden">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-2 text-slate-700 hover:border-rose-500 hover:text-rose-700"
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        {/* デスクトップ: サイドバー */}
        <aside className="hidden w-56 flex-shrink-0 lg:block">
          <nav className="sticky top-20 space-y-1 text-sm">
            <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Super Admin
            </p>
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-slate-700 hover:bg-rose-50 hover:text-rose-700"
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            ))}
            <hr className="my-3 border-slate-200" />
            <Link
              href="/admin"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-500 hover:bg-slate-100"
            >
              <span>↩</span> 通常管理画面 へ
            </Link>
          </nav>
        </aside>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
