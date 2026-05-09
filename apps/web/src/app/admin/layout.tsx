import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/admin', label: 'ダッシュボード' },
  { href: '/admin/contents', label: 'コンテンツ' },
  { href: '/admin/products', label: '商品' },
  { href: '/admin/orders', label: '注文' },
  { href: '/admin/videos', label: '動画' },
  { href: '/admin/live', label: 'ライブ' },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/admin');
  if (session.user.role !== 'ADMIN') redirect('/');

  return (
    <div className="mx-auto min-h-[calc(100vh-3.5rem)] max-w-7xl px-3 py-4 sm:px-4 sm:py-6 lg:flex lg:gap-6">
      {/* モバイル: 横スクロールタブナビ */}
      <nav className="-mx-3 mb-4 flex gap-1 overflow-x-auto px-3 pb-2 text-sm lg:hidden">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex-shrink-0 rounded-full border border-slate-200 bg-white px-3 py-2 text-slate-700 hover:border-brand-500 hover:text-brand-600"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {/* デスクトップ: サイドバー */}
      <aside className="hidden w-52 flex-shrink-0 lg:block">
        <nav className="sticky top-20 space-y-1 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
