'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import {
  Home,
  Image as ImageIcon,
  ShoppingBag,
  Gamepad2,
  Bell,
  Sparkles,
  ShoppingCart,
  User,
  LogIn,
  LogOut,
  UserPlus,
  Shield,
  Crown,
  CreditCard,
  Repeat,
  MessageCircle,
  Menu,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCartItemCount } from '@/stores/cart-store';
import { Badge } from '@/components/ui/Badge';
import { isAdmin as roleIsAdmin, isSuperAdmin } from '@idol/shared';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** カートバッジ用 */
  badge?: 'cart';
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

// ===== メインナビ（将来項目が増えてもここに追加するだけ） =====
const NAV_GROUPS: NavGroup[] = [
  {
    title: 'メニュー',
    items: [
      { href: '/', label: 'ホーム', icon: Home },
      { href: '/contents', label: 'コンテンツ', icon: ImageIcon },
      { href: '/game', label: 'ゲーム', icon: Gamepad2 },
      { href: '/notices', label: 'お知らせ', icon: Bell },
    ],
  },
  {
    title: 'ショップ',
    items: [
      { href: '/products', label: 'グッズ', icon: ShoppingBag },
      { href: '/plans', label: 'プラン', icon: Sparkles },
      { href: '/cart', label: 'カート', icon: ShoppingCart, badge: 'cart' },
    ],
  },
];

// ===== 会員メニュー（ログイン時のみ表示） =====
const MEMBER_GROUP: NavGroup = {
  title: '会員',
  items: [
    { href: '/me/card', label: '会員カード', icon: CreditCard },
    { href: '/me/points', label: 'ポイント交換', icon: Repeat },
    { href: '/me/games/acchi', label: 'あっち向いてホイ', icon: Gamepad2 },
    { href: '/me/dm', label: 'REIRIE への DM', icon: MessageCircle },
  ],
};

export function Sidebar() {
  const { data: session, status } = useSession();
  const cartCount = useCartItemCount();
  const isAdmin = roleIsAdmin(session?.user?.role);
  const isSuper = isSuperAdmin(session?.user?.role);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // ルート変更でモバイルメニューを閉じる
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // モバイルメニュー表示中はスクロール抑止
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      {/* ===== モバイル上部バー ===== */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-white/15 bg-twilight-plum/85 px-4 backdrop-blur-xl md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="メニューを開く"
          className="-ml-2 inline-flex h-10 w-10 items-center justify-center rounded-md text-twilight-cream hover:bg-white/10"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <Link
          href="/"
          className="font-serif text-lg font-semibold tracking-wide text-twilight-cream text-glow"
        >
          ReiRieRoom
        </Link>
        <Link
          href="/cart"
          aria-label={`カート (${cartCount}点)`}
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-md text-twilight-cream hover:bg-white/10"
        >
          <ShoppingCart className="h-5 w-5" aria-hidden="true" />
          {cartCount > 0 && (
            <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-twilight-btn px-1 text-[10px] font-semibold text-white">
              {cartCount}
            </span>
          )}
        </Link>
      </header>

      {/* ===== PC: 固定サイドバー ===== */}
      <aside className="hidden md:fixed md:inset-y-0 md:left-0 md:z-30 md:flex md:w-64 md:flex-col md:border-r md:border-white/10 md:bg-twilight-plum">
        <SidebarContent
          cartCount={cartCount}
          status={status}
          session={session}
          isAdmin={isAdmin}
          isSuper={isSuper}
          pathname={pathname}
        />
      </aside>

      {/* ===== モバイル: スライドインドロワー ===== */}
      <div
        className={`fixed inset-0 z-50 md:hidden ${
          open ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
        aria-hidden={!open}
      >
        {/* オーバーレイ */}
        <div
          className={`absolute inset-0 bg-twilight-plum/60 backdrop-blur-sm transition-opacity ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={() => setOpen(false)}
        />
        {/* ドロワー本体 */}
        <aside
          className={`absolute inset-y-0 left-0 flex w-72 max-w-[80%] flex-col bg-twilight-plum shadow-2xl transition-transform ${
            open ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="メニューを閉じる"
            className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-md text-twilight-cream hover:bg-white/10"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          <SidebarContent
            cartCount={cartCount}
            status={status}
            session={session}
            isAdmin={isAdmin}
            isSuper={isSuper}
            pathname={pathname}
          />
        </aside>
      </div>
    </>
  );
}

/* ===== サイドバー中身（PC / モバイル共通） ===== */
function SidebarContent({
  cartCount,
  status,
  session,
  isAdmin,
  isSuper,
  pathname,
}: {
  cartCount: number;
  status: string;
  session: ReturnType<typeof useSession>['data'];
  isAdmin: boolean;
  isSuper: boolean;
  pathname: string;
}) {
  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-6 text-twilight-cream">
      {/* ロゴ */}
      <Link
        href="/"
        className="mb-1 px-2 font-serif text-2xl font-semibold tracking-wide text-twilight-cream text-glow"
      >
        ReiRieRoom
      </Link>
      <p className="mb-6 px-2 font-serif text-[10px] uppercase tracking-[0.3em] text-twilight-rose/80">
        Amethyst Room
      </p>

      {/* ナビゲーション */}
      <nav className="flex-1 space-y-6">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-twilight-cream/40">
              {group.title}
            </p>
            <ul className="space-y-1">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink
                    item={item}
                    active={
                      item.href === '/'
                        ? pathname === '/'
                        : pathname.startsWith(item.href)
                    }
                    cartCount={cartCount}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* 会員メニュー（ログイン時のみ） */}
        {session?.user && (
          <div>
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-twilight-cream/40">
              {MEMBER_GROUP.title}
            </p>
            <ul className="space-y-1">
              {MEMBER_GROUP.items.map((item) => (
                <li key={item.href}>
                  <NavLink
                    item={item}
                    active={pathname.startsWith(item.href)}
                    cartCount={cartCount}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 管理メニュー */}
        {(isAdmin || isSuper) && (
          <div>
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-twilight-cream/40">
              管理
            </p>
            <ul className="space-y-1">
              {isAdmin && (
                <li>
                  <NavLink
                    item={{ href: '/admin', label: '管理ダッシュボード', icon: Shield }}
                    active={pathname.startsWith('/admin')}
                    cartCount={cartCount}
                  />
                </li>
              )}
              {isSuper && (
                <li>
                  <NavLink
                    item={{ href: '/super-admin', label: 'スーパー管理者', icon: Crown }}
                    active={pathname.startsWith('/super-admin')}
                    cartCount={cartCount}
                    special
                  />
                </li>
              )}
            </ul>
          </div>
        )}
      </nav>

      {/* アカウント領域 */}
      <div className="mt-6 border-t border-white/10 pt-4">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-twilight-cream/40">
          アカウント
        </p>
        {status === 'loading' ? (
          <div className="px-3 py-2 text-sm text-twilight-cream/50">読み込み中…</div>
        ) : session?.user ? (
          <div className="space-y-1">
            <NavLink
              item={{ href: '/me', label: 'マイページ', icon: User }}
              active={pathname.startsWith('/me')}
              cartCount={cartCount}
            />
            <div className="flex items-center gap-2 px-3 py-1">
              <p className="truncate text-xs text-twilight-cream/55">{session.user.email}</p>
              {session.user.plan && session.user.plan !== 'FREE' && (
                <Badge tone={session.user.plan === 'PREMIUM' ? 'brand' : 'info'}>
                  {session.user.plan}
                </Badge>
              )}
            </div>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: '/' })}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-twilight-cream/75 transition hover:bg-white/10 hover:text-twilight-rose"
            >
              <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
              ログアウト
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <NavLink
              item={{ href: '/signin', label: 'ログイン', icon: LogIn }}
              active={pathname.startsWith('/signin')}
              cartCount={cartCount}
            />
            <Link
              href="/signup"
              className="flex items-center justify-center gap-2 rounded-full bg-twilight-btn px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
            >
              <UserPlus className="h-[18px] w-[18px]" aria-hidden="true" />
              新規会員登録
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===== ナビリンク（アイコン + ラベル + アクティブ表示 + カートバッジ） ===== */
function NavLink({
  item,
  active,
  cartCount,
  special,
}: {
  item: NavItem;
  active: boolean;
  cartCount: number;
  special?: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
        active
          ? 'bg-twilight-btn text-white shadow-sm'
          : special
            ? 'text-twilight-gold hover:bg-white/10'
            : 'text-twilight-cream/75 hover:bg-white/10 hover:text-twilight-cream'
      }`}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      <span className="flex-1">{item.label}</span>
      {item.badge === 'cart' && cartCount > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-twilight-rose px-1.5 text-[11px] font-semibold text-twilight-plum">
          {cartCount}
        </span>
      )}
    </Link>
  );
}
