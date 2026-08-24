'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import {
  Home,
  Image as ImageIcon,
  PlayCircle,
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
  Gift,
  MessageCircle,
  Menu,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCartItemCount } from '@/stores/cart-store';
import { useMemberSummaryStore, useMemberSummary } from '@/stores/member-summary-store';
import { RankBadge } from '@/components/membership/RankBadge';
import { Badge } from '@/components/ui/Badge';
import { isAdmin as roleIsAdmin, PLAN_LABELS } from '@idol/shared';
import { resolveAdminNavVisibility, type AdminNavVisibility } from '@/lib/admin-nav';

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
      // 動画は content でなく video テーブルなので専用の導線が必要。
      // 以前はこのリンクが無く、動画を公開しても会員が到達できなかった。
      { href: '/me/videos', label: '動画', icon: PlayCircle },
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
    { href: '/me/points', label: 'ポイント履歴', icon: Repeat },
    { href: '/me/rewards', label: '景品交換', icon: Gift },
    { href: '/me/dm', label: 'REIRIE への DM', icon: MessageCircle },
  ],
};

export function Sidebar({
  contentsVisible = true,
  productsVisible = true,
  dmVisible = true,
  gamesVisible = true,
}: {
  /** /super-admin/settings のトグルで OFF の場合、対応するナビ項目を非表示にする */
  contentsVisible?: boolean;
  productsVisible?: boolean;
  dmVisible?: boolean;
  gamesVisible?: boolean;
} = {}) {
  const { data: session, status } = useSession();
  const cartCount = useCartItemCount();
  const role = session?.user?.role;
  // ロールごとの管理メニュー表示判定は lib/admin-nav.ts に集約 (単体テストあり)。
  // 以前は isSuperAdmin() で判定していたため STAFF には
  // スーパー管理画面へのリンクが一切表示されなかった。
  const nav = resolveAdminNavVisibility(role);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const navGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.href === '/contents') return contentsVisible;
      // 動画はコンテンツの一部なので、コンテンツ非公開時はともに隠す。
      if (item.href === '/me/videos') return contentsVisible;
      if (item.href === '/products') return productsVisible;
      // ゲームは非公開中でも管理者には表示する (開発中の動作確認のため)。
      // 一般会員にはナビからもページからも完全に見えなくなる。
      if (item.href === '/game') return gamesVisible || roleIsAdmin(role);
      return true;
    }),
  })).filter((group) => group.items.length > 0);

  const memberGroup: NavGroup = {
    ...MEMBER_GROUP,
    items: MEMBER_GROUP.items.filter((item) => {
      if (item.href === '/me/dm') return dmVisible;
      return true;
    }),
  };

  // ログイン中はプラン/ランク/ポイントを取得し、ログアウトしたらクリア
  useEffect(() => {
    if (status === 'authenticated') {
      useMemberSummaryStore.getState().fetchSummary();
    } else if (status === 'unauthenticated') {
      useMemberSummaryStore.getState().clear();
    }
  }, [status]);

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
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b-2 border-black bg-white/90 px-4 backdrop-blur-xl md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="メニューを開く"
          className="-ml-2 inline-flex h-10 w-10 items-center justify-center rounded-md text-black hover:bg-twilight-lavender/40"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <Link href="/" className="text-lg font-black tracking-wide text-black">
          ReiRieRoom
        </Link>
        <Link
          href="/cart"
          aria-label={`カート (${cartCount}点)`}
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-md text-black hover:bg-twilight-lavender/40"
        >
          <ShoppingCart className="h-5 w-5" aria-hidden="true" />
          {cartCount > 0 && (
            <span className="absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-twilight-rose px-1 text-[10px] font-semibold text-white">
              {cartCount}
            </span>
          )}
        </Link>
      </header>

      {/* ===== PC: 固定サイドバー ===== */}
      <aside className="hidden md:fixed md:inset-y-0 md:left-0 md:z-30 md:flex md:w-64 md:flex-col md:border-r-2 md:border-black md:bg-white">
        <SidebarContent
          navGroups={navGroups}
          memberGroup={memberGroup}
          cartCount={cartCount}
          status={status}
          session={session}
          nav={nav}
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
          className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity ${
            open ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={() => setOpen(false)}
        />
        {/* ドロワー本体 */}
        <aside
          className={`absolute inset-y-0 left-0 flex w-72 max-w-[80%] flex-col border-r-2 border-black bg-white shadow-2xl transition-transform ${
            open ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="メニューを閉じる"
            className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-md text-black hover:bg-twilight-lavender/40"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          <SidebarContent
            navGroups={navGroups}
            memberGroup={memberGroup}
            cartCount={cartCount}
            status={status}
            session={session}
            nav={nav}
            pathname={pathname}
          />
        </aside>
      </div>
    </>
  );
}

/* ===== サイドバー中身（PC / モバイル共通） ===== */
function SidebarContent({
  navGroups,
  memberGroup,
  cartCount,
  status,
  session,
  nav,
  pathname,
}: {
  navGroups: NavGroup[];
  memberGroup: NavGroup;
  cartCount: number;
  status: string;
  session: ReturnType<typeof useSession>['data'];
  /** ロールに応じた管理メニューの表示判定 */
  nav: AdminNavVisibility;
  pathname: string;
}) {
  const summary = useMemberSummary();
  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-6 text-black">
      {/* ロゴ */}
      <Link href="/" className="mb-6 px-2 text-2xl font-black tracking-wide text-black">
        ReiRieRoom
      </Link>

      {/* ナビゲーション */}
      <nav className="flex-1 space-y-6">
        {navGroups.map((group) => (
          <div key={group.title}>
            <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-black/40">
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
        {session?.user && memberGroup.items.length > 0 && (
          <div>
            <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-black/40">
              {memberGroup.title}
            </p>
            <ul className="space-y-1">
              {memberGroup.items.map((item) => (
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
        {nav.showAdminSection && (
          <div>
            <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-black/40">
              管理
            </p>
            <ul className="space-y-1">
              {nav.showAdminDashboard && (
                <li>
                  <NavLink
                    item={{ href: '/admin', label: '管理ダッシュボード', icon: Shield }}
                    active={pathname.startsWith('/admin')}
                    cartCount={cartCount}
                  />
                </li>
              )}
              {nav.showSuperAdmin && (
                <li>
                  <NavLink
                    item={{
                      href: '/super-admin',
                      // STAFF は閲覧のみなのでラベルを変えて誤解を防ぐ
                      label: nav.superAdminLabel,
                      icon: Crown,
                    }}
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
      <div className="mt-6 border-t border-black/10 pt-4">
        <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-black/40">
          アカウント
        </p>
        {status === 'loading' ? (
          <div className="px-3 py-2 text-sm text-black/50">読み込み中…</div>
        ) : session?.user ? (
          <div className="space-y-1">
            <NavLink
              item={{ href: '/me', label: 'マイページ', icon: User }}
              active={pathname === '/me'}
              cartCount={cartCount}
            />

            {/* 会員プラン・ランク・保有 Pui */}
            <div className="mx-1 my-1 space-y-2 rounded-xl bg-twilight-lavender/25 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-black/40">
                  プラン
                </span>
                <Badge tone={summary?.plan === 'PREMIUM' ? 'brand' : summary?.plan === 'STANDARD' ? 'info' : 'gray'}>
                  {summary ? PLAN_LABELS[summary.plan] : '—'}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-black/40">
                  ランク
                </span>
                {summary ? <RankBadge rank={summary.rank} size="sm" /> : (
                  <span className="text-xs text-black/40">—</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-black/40">
                  Pui
                </span>
                <span className="text-sm font-bold text-black">
                  {summary ? summary.points.toLocaleString() : '—'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 px-3 py-1">
              <p className="truncate text-xs text-black/55">{session.user.email}</p>
            </div>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: '/' })}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-black/75 transition hover:bg-twilight-lavender/40 hover:text-twilight-rose"
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
              className="flex items-center justify-center gap-2 rounded-full bg-twilight-btn px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-white shadow-sm transition hover:opacity-90"
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
      className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
        active
          ? 'bg-twilight-btn text-white shadow-sm'
          : special
            ? 'text-twilight-rose hover:bg-twilight-lavender/40'
            : 'text-black/75 hover:bg-twilight-lavender/40 hover:text-black'
      }`}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      <span className="flex-1">{item.label}</span>
      {item.badge === 'cart' && cartCount > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-twilight-rose px-1.5 text-[11px] font-semibold text-white">
          {cartCount}
        </span>
      )}
    </Link>
  );
}
