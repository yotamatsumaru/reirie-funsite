/**
 * /super-admin レイアウト
 *
 * - SUPER_ADMIN 専用 (ADMIN は /admin に誘導)
 * - サイドナビ + モバイル横スクロールタブ
 * - lucide-react アイコンに統一
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Receipt,
  Gamepad2,
  SlidersHorizontal,
  Megaphone,
  Settings,
  ScrollText,
  ShieldCheck,
  ArrowLeftRight,
  ShieldAlert,
  Coins,
  Wallet,
  ListChecks,
  MessageCircle,
  Gift,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';
import { auth } from '@/auth';
import { AdminThemeProvider } from '@/components/admin/AdminThemeProvider';
import { AdminThemeToggle } from '@/components/admin/AdminThemeToggle';

export const dynamic = 'force-dynamic';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const NAV: NavItem[] = [
  { href: '/super-admin', label: 'ダッシュボード', icon: LayoutDashboard },
  { href: '/super-admin/users', label: 'ユーザー', icon: Users },
  { href: '/super-admin/subscriptions', label: 'サブスク', icon: CreditCard },
  { href: '/super-admin/orders', label: '注文・売上', icon: Receipt },
  { href: '/super-admin/sales', label: '売上管理', icon: BarChart3 },
  { href: '/super-admin/game', label: 'ゲーム経済', icon: Gamepad2 },
  { href: '/super-admin/game-settings', label: 'ゲーム設定', icon: SlidersHorizontal },
  { href: '/super-admin/points', label: 'ポイント設定', icon: Coins },
  { href: '/super-admin/points/users', label: 'ポイント状況', icon: Wallet },
  { href: '/super-admin/points/transactions', label: 'ポイント取引ログ', icon: ListChecks },
  { href: '/super-admin/rewards', label: '特典ポイント', icon: Gift },
  { href: '/super-admin/rewards/packs', label: '特典ポイントパック', icon: Gift },
  { href: '/super-admin/announcements', label: 'お知らせ', icon: Megaphone },
  { href: '/super-admin/dm', label: 'DM 管理', icon: MessageCircle },
  { href: '/super-admin/settings', label: 'システム設定', icon: Settings },
  { href: '/super-admin/audit', label: '監査ログ', icon: ScrollText },
  { href: '/super-admin/admins', label: '管理者', icon: ShieldCheck },
];

export default async function SuperAdminLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/super-admin');
  if (session.user.role !== 'SUPER_ADMIN') redirect('/');

  return (
    <AdminThemeProvider>
      <div className="min-h-[calc(100vh-3.5rem)] bg-slate-50">
        {/* SUPER_ADMIN バナー */}
        <div className="border-b border-rose-200/70 bg-rose-50/80 px-3 py-2 sm:px-4">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 text-xs">
            <p className="flex items-center gap-2 font-semibold text-rose-700">
              <ShieldAlert className="h-4 w-4" aria-hidden />
              SUPER ADMIN モード
            </p>
            <div className="flex items-center gap-3">
              <p className="hidden text-rose-600/80 sm:block">
                {session.user.email} としてログイン中
              </p>
              <AdminThemeToggle />
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-8 lg:flex lg:gap-8">
          {/* モバイル: 横スクロールタブ */}
          <nav className="-mx-3 mb-4 flex gap-1.5 overflow-x-auto px-3 pb-2 text-sm lg:hidden">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-slate-700 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
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
                Super Admin
              </p>
              <ul className="space-y-0.5">
                {NAV.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-rose-50 hover:text-rose-700"
                      >
                        <Icon
                          className="h-4 w-4 text-slate-400 transition-colors group-hover:text-rose-500"
                          aria-hidden
                        />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>

              <hr className="my-4 border-slate-200" />

              <Link
                href="/admin"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <ArrowLeftRight className="h-4 w-4" aria-hidden />
                通常管理画面 へ
              </Link>
            </nav>
          </aside>

          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </AdminThemeProvider>
  );
}
