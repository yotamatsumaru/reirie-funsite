import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  ShoppingBag,
  Receipt,
  Video,
  Radio,
  Gamepad2,
  PhoneCall,
  type LucideIcon,
} from 'lucide-react';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const NAV: NavItem[] = [
  { href: '/admin', label: 'ダッシュボード', icon: LayoutDashboard },
  { href: '/admin/contents', label: 'コンテンツ', icon: FileText },
  { href: '/admin/products', label: '商品', icon: ShoppingBag },
  { href: '/admin/orders', label: '注文', icon: Receipt },
  { href: '/admin/videos', label: '動画', icon: Video },
  { href: '/admin/live', label: 'ライブ', icon: Radio },
  { href: '/admin/game', label: 'ゲーム', icon: Gamepad2 },
  { href: '/admin/call', label: '1on1コール', icon: PhoneCall },
  { href: '/admin/call/events', label: '特典会イベント', icon: PhoneCall },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/admin');
  // ADMIN または SUPER_ADMIN
  if (session.user.role !== 'ADMIN' && session.user.role !== 'SUPER_ADMIN') redirect('/');

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-slate-50">
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-8 lg:flex lg:gap-8">
        {/* モバイル: 横スクロールタブナビ */}
        <nav className="-mx-3 mb-4 flex gap-1.5 overflow-x-auto px-3 pb-2 text-sm lg:hidden">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-slate-700 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
              >
                <Icon className="h-4 w-4" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* デスクトップ: サイドバー */}
        <aside className="hidden w-60 flex-shrink-0 lg:block">
          <nav className="sticky top-20">
            <p className="px-3 pb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Admin
            </p>
            <ul className="space-y-0.5">
              {NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
                    >
                      <Icon
                        className="h-4 w-4 text-slate-400 transition-colors group-hover:text-brand-600"
                        aria-hidden
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
