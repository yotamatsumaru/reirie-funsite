'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import {
  Home,
  PlayCircle,
  FileText,
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
  ChevronDown,
  type LucideIcon,
} from 'lucide-react';
import { useCartItemCount } from '@/stores/cart-store';
import { useMemberSummaryStore, useMemberSummary } from '@/stores/member-summary-store';
import { RankBadge } from '@/components/membership/RankBadge';
import { Badge } from '@/components/ui/Badge';
import { isAdmin as roleIsAdmin, PLAN_LABELS } from '@idol/shared';
import { resolveAdminNavVisibility, type AdminNavVisibility } from '@/lib/admin-nav';
import {
  NAV_GROUPS,
  filterNavGroups,
  isNavItemActive,
  resolveNavItemState,
  type NavGroup,
  type NavIconKey,
  type NavItem,
} from '@/lib/site-nav';

/**
 * ナビ構造 (lib/site-nav.ts) はテストしたいので React 非依存にしてあり、
 * アイコンは文字列キーで持っている。実体の解決はここで行う。
 */
const NAV_ICONS: Record<NavIconKey, LucideIcon> = {
  home: Home,
  blog: FileText,
  video: PlayCircle,
  game: Gamepad2,
  notice: Bell,
  goods: ShoppingBag,
  plan: Sparkles,
  cart: ShoppingCart,
};

/** 会員メニュー等、階層を持たない項目用の簡易型 */
type FlatNavItem = { href: string; label: string; icon: LucideIcon; badge?: 'cart' };

// ===== 会員メニュー（ログイン時のみ表示） =====
const MEMBER_ITEMS: FlatNavItem[] = [
  { href: '/me/card', label: '会員カード', icon: CreditCard },
  { href: '/me/points', label: 'ポイント履歴', icon: Repeat },
  { href: '/me/rewards', label: '景品交換', icon: Gift },
  { href: '/me/dm', label: 'REIRIE への DM', icon: MessageCircle },
];

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

  const navGroups = useMemo(
    () =>
      filterNavGroups(NAV_GROUPS, (item) => {
        // contentsVisible は「記事・動画セクション全体」のマスタースイッチ。
        // 以前は親の /contents 1 つを落とせば配下のブログ / 動画も
        // まとめて消えたが、親を廃止して並列にしたので
        // ブログ・動画それぞれに同じ判定を掛ける必要がある。
        // (ここを片方だけにすると、OFF なのに一方だけナビに残り、
        //  クリックすると 404 になる)
        if (item.href === '/blog') return contentsVisible;
        if (item.href === '/me/videos') return contentsVisible;
        if (item.href === '/products') return productsVisible;
        // ゲームは非公開中でも管理者には表示する (開発中の動作確認のため)。
        // 一般会員にはナビからもページからも完全に見えなくなる。
        if (item.href === '/game') return gamesVisible || roleIsAdmin(role);
        return true;
      }),
    [contentsVisible, productsVisible, gamesVisible, role],
  );

  const memberItems = useMemo(
    () => MEMBER_ITEMS.filter((item) => (item.href === '/me/dm' ? dmVisible : true)),
    [dmVisible],
  );

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
          memberItems={memberItems}
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
            memberItems={memberItems}
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
  memberItems,
  cartCount,
  status,
  session,
  nav,
  pathname,
}: {
  navGroups: NavGroup[];
  memberItems: FlatNavItem[];
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
                  <NavTreeItem item={item} pathname={pathname} cartCount={cartCount} />
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* 会員メニュー（ログイン時のみ） */}
        {session?.user && memberItems.length > 0 && (
          <div>
            <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-black/40">
              会員
            </p>
            <ul className="space-y-1">
              {memberItems.map((item) => (
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

/**
 * ===== 階層ナビ項目（親 + 折りたたみ可能な子リスト） =====
 *
 * 「コンテンツ」の下に「ブログ」「動画」を入れ子にするための描画。
 *
 * 設計:
 *   - 親リンク自体はクリックでき、/contents（すべて）に飛ぶ。
 *     子を隠すためにリンクを潰さない（「コンテンツ全部」を見る導線は残す）。
 *   - 開閉はリンクとは別の三角ボタンで行う。リンクと同じ要素にすると
 *     ページ遷移せず開閉するだけになり、親ページに行けなくなる。
 *   - 選択中の子があるときは強制的に開く（判定は lib/site-nav.ts）。
 */
function NavTreeItem({
  item,
  pathname,
  cartCount,
}: {
  item: NavItem;
  pathname: string;
  cartCount: number;
}) {
  // 手動トグルはルート変更で破棄する。そうしないと
  // 「畳んだ状態で子ページへ遷移 → 選択中の項目が見えない」が起きる。
  const [manualOpen, setManualOpen] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    setManualOpen(undefined);
  }, [pathname]);

  const state = resolveNavItemState(item, pathname, manualOpen);
  const children = item.children ?? [];
  const Icon = NAV_ICONS[item.iconKey];

  // 子を持たない項目は従来どおりのフラットなリンク
  if (children.length === 0) {
    return (
      <NavLink
        item={{ href: item.href, label: item.label, icon: Icon, badge: item.badge }}
        active={state.active}
        cartCount={cartCount}
      />
    );
  }

  const submenuId = `nav-sub-${item.href.replace(/[^a-zA-Z0-9]/g, '-')}`;

  return (
    <div>
      <div
        className={`group flex items-center rounded-xl pr-1 transition ${
          state.active
            ? 'bg-twilight-btn text-white shadow-sm'
            : state.childActive
              ? 'bg-twilight-lavender/30 text-black'
              : 'text-black/75 hover:bg-twilight-lavender/40 hover:text-black'
        }`}
      >
        <Link
          href={item.href}
          aria-current={state.active ? 'page' : undefined}
          className="flex flex-1 items-center gap-3 px-3 py-2.5 text-sm font-semibold"
        >
          <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
          <span className="flex-1">{item.label}</span>
        </Link>
        <button
          type="button"
          onClick={() => setManualOpen(!state.expanded)}
          aria-expanded={state.expanded}
          aria-controls={submenuId}
          aria-label={`${item.label}のサブメニューを${state.expanded ? '閉じる' : '開く'}`}
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${
            state.active ? 'hover:bg-white/20' : 'hover:bg-black/5'
          }`}
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${state.expanded ? '' : '-rotate-90'}`}
            aria-hidden="true"
          />
        </button>
      </div>

      {state.expanded && (
        <ul
          id={submenuId}
          // 縦線 + インデントで「配下」であることを視覚的に示す
          className="ml-5 mt-1 space-y-1 border-l-2 border-black/10 pl-2"
        >
          {children.map((child) => {
            const ChildIcon = NAV_ICONS[child.iconKey];
            const childActive = isNavItemActive(child.href, pathname);
            return (
              <li key={child.href}>
                <NavLink
                  item={{
                    href: child.href,
                    label: child.label,
                    icon: ChildIcon,
                    badge: child.badge,
                  }}
                  active={childActive}
                  cartCount={cartCount}
                  compact
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ===== ナビリンク（アイコン + ラベル + アクティブ表示 + カートバッジ） ===== */
function NavLink({
  item,
  active,
  cartCount,
  special,
  compact,
}: {
  item: FlatNavItem;
  active: boolean;
  cartCount: number;
  special?: boolean;
  /** 入れ子の子項目。親より一段控えめな見た目にする */
  compact?: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex items-center gap-3 rounded-xl transition ${
        compact ? 'px-3 py-2 text-[13px] font-semibold' : 'px-3 py-2.5 text-sm font-semibold'
      } ${
        active
          ? 'bg-twilight-btn text-white shadow-sm'
          : special
            ? 'text-twilight-rose hover:bg-twilight-lavender/40'
            : 'text-black/75 hover:bg-twilight-lavender/40 hover:text-black'
      }`}
    >
      <Icon
        className={`${compact ? 'h-4 w-4' : 'h-[18px] w-[18px]'} shrink-0`}
        aria-hidden="true"
      />
      <span className="flex-1">{item.label}</span>
      {item.badge === 'cart' && cartCount > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-twilight-rose px-1.5 text-[11px] font-semibold text-white">
          {cartCount}
        </span>
      )}
    </Link>
  );
}
