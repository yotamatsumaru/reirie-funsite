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
  Gift,
  Truck,
  Sofa,
  type LucideIcon,
} from 'lucide-react';
import { auth } from '@/auth';
import { hasCapability, hasAnyCapability, type AdminCapabilityLiteral } from '@idol/shared';
import { AdminThemeProvider } from '@/components/admin/AdminThemeProvider';
import { AdminThemeToggle } from '@/components/admin/AdminThemeToggle';

export const dynamic = 'force-dynamic';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** 表示に必要な管理権限。null はダッシュボード等（全管理者に表示） */
  capability: AdminCapabilityLiteral | null;
};

const NAV: NavItem[] = [
  { href: '/admin', label: 'ダッシュボード', icon: LayoutDashboard, capability: null },
  { href: '/admin/contents', label: 'コンテンツ', icon: FileText, capability: 'CONTENT' },
  { href: '/admin/videos', label: '動画', icon: Video, capability: 'CONTENT' },
  { href: '/admin/live', label: 'ライブ', icon: Radio, capability: 'CONTENT' },
  { href: '/admin/products', label: '商品', icon: ShoppingBag, capability: 'MERCH' },
  { href: '/admin/orders', label: '注文', icon: Receipt, capability: 'MERCH' },
  { href: '/admin/game', label: 'ゲーム', icon: Gamepad2, capability: 'GAME' },
  // MyRoom は現在非公開 (site.sectionVisibility.myRoomVisible の既定が false) の
  // 開発中機能。家具は会員に見せるサイト素材なので CONTENT 権限で扱う。
  { href: '/admin/myroom/furnitures', label: 'MyRoom家具', icon: Sofa, capability: 'CONTENT' },
  { href: '/admin/rewards/catalog', label: '景品カタログ', icon: Gift, capability: 'MERCH' },
  { href: '/admin/rewards/redemptions', label: '発送管理', icon: Truck, capability: 'MERCH' },
  { href: '/admin/call', label: '1on1コール', icon: PhoneCall, capability: 'CALL' },
  { href: '/admin/call/events', label: '特典会イベント', icon: PhoneCall, capability: 'CALL' },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/admin');
  // ADMIN または SUPER_ADMIN
  if (session.user.role !== 'ADMIN' && session.user.role !== 'SUPER_ADMIN') redirect('/');

  const principal = {
    role: session.user.role,
    capabilities: session.user.capabilities,
  };
  // 管理領域を1つも持たない ADMIN は管理画面に入れない
  if (!hasAnyCapability(principal)) redirect('/');

  // 保有権限のメニューだけ表示（ダッシュボードは常に表示）
  const nav = NAV.filter(
    (item) => item.capability === null || hasCapability(principal, item.capability),
  );

  return (
    <AdminThemeProvider>
      <div className="min-h-[calc(100vh-3.5rem)] bg-slate-50">
        <div className="mx-auto max-w-7xl px-3 py-4 sm:px-4 sm:py-8 lg:flex lg:gap-8">
          {/* モバイル: 横スクロールタブナビ + テーマ切替 */}
          <div className="-mx-3 mb-4 flex items-center gap-2 overflow-x-auto px-3 pb-2 lg:hidden">
            <nav className="flex flex-1 gap-1.5 overflow-x-auto text-sm">
              {nav.map((item) => {
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
            <AdminThemeToggle />
          </div>

          {/* デスクトップ: サイドバー */}
          <aside className="hidden w-60 flex-shrink-0 lg:block">
            <nav className="sticky top-20">
              <div className="flex items-center justify-between px-3 pb-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Admin
                </p>
                <AdminThemeToggle />
              </div>
              <ul className="space-y-0.5">
                {nav.map((item) => {
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
    </AdminThemeProvider>
  );
}
