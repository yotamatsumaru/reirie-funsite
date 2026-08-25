/**
 * サイドバー（メインナビ）の構造と、アクティブ判定 / 開閉判定。
 *
 * ## なぜ別ファイルに切り出すか
 *
 * Sidebar.tsx は 'use client' コンポーネントで、jest の設定が
 * `testMatch: ['**\/*.test.ts']`（.tsx は対象外）のためテストが書けない。
 * 「どの項目がどの親の下にあるか」「今どのリンクがアクティブか」は
 * 一度崩れると全ページで導線が壊れる箇所なので、純粋関数としてここに集約し
 * 単体テストで固定する（lib/admin-nav.ts と同じ方針）。
 *
 * ## 階層構造にした理由
 *
 * 以前は「コンテンツ」と「動画」がフラットに並んでいた。しかし
 * 動画は content テーブルではなく video テーブルという *実装上の都合* で
 * 別ページになっているだけで、利用者から見ればどちらも「コンテンツ」。
 * 並列に見えると「コンテンツを見たのに動画が無い / 動画はコンテンツじゃないの?」
 * という誤解を招くため、コンテンツの子として入れ子にする。
 *
 *   コンテンツ            … /contents  (記事 + 動画をまとめた一覧)
 *     ├ ブログ            … /blog      (記事のみ)
 *     └ 動画              … /me/videos (動画のみ)
 *
 * 「ブログ」はこれまでナビに存在せず、記事だけを見る導線が無かったため新設する。
 *
 * ## href にクエリを使わない理由（重要）
 *
 * 当初「ブログ」を `/contents?type=blog` にしたが、アクティブ判定のために
 * Sidebar (= ルートレイアウト) で `useSearchParams()` を呼ぶ必要が生じ、
 * サイドバーが全ページに入っている都合で **静的プリレンダリングが全滅** した
 * (`useSearchParams() should be wrapped in a suspense boundary` でビルド失敗)。
 * そのためナビの href は常にクエリ無しのパスにし、ブログは専用ルート /blog を持つ。
 *
 * ## アイコンを直接持たない理由
 *
 * lucide-react の LucideIcon をここで import すると、このモジュールが
 * React 依存になりテストが重くなる（かつ node 環境で壊れる）。
 * そのため文字列キー(NavIconKey)だけを持ち、実体のマッピングは
 * Sidebar.tsx 側の NAV_ICONS で行う。
 */

/** Sidebar.tsx の NAV_ICONS が解決するアイコンキー */
export type NavIconKey =
  | 'home'
  | 'contents'
  | 'blog'
  | 'video'
  | 'game'
  | 'notice'
  | 'goods'
  | 'plan'
  | 'cart';

export type NavItem = {
  href: string;
  label: string;
  iconKey: NavIconKey;
  /** カートバッジ用 */
  badge?: 'cart';
  /** 入れ子の子項目（コンテンツ配下のブログ / 動画） */
  children?: NavItem[];
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

/** メインナビの構造。項目が増える場合はここに追加する。 */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'メニュー',
    items: [
      { href: '/', label: 'ホーム', iconKey: 'home' },
      {
        href: '/contents',
        label: 'コンテンツ',
        iconKey: 'contents',
        children: [
          // 記事だけの一覧。/contents は記事 + 動画の混合なので別ルートにする。
          { href: '/blog', label: 'ブログ', iconKey: 'blog' },
          // 動画は video テーブルなので専用ページ。/contents にも混ざって出るが、
          // 尺・鍵表示など動画向けの一覧はこちらが本体。
          { href: '/me/videos', label: '動画', iconKey: 'video' },
        ],
      },
      { href: '/game', label: 'ゲーム', iconKey: 'game' },
      { href: '/notices', label: 'お知らせ', iconKey: 'notice' },
    ],
  },
  {
    title: 'ショップ',
    items: [
      { href: '/products', label: 'グッズ', iconKey: 'goods' },
      { href: '/plans', label: 'プラン', iconKey: 'plan' },
      { href: '/cart', label: 'カート', iconKey: 'cart', badge: 'cart' },
    ],
  },
];

/**
 * パスの前方一致判定（セグメント境界を見る）。
 *
 * 以前は `pathname.startsWith(item.href)` だったため
 * `/contents` が `/contentsomething` でも点灯しうる。ここでは境界で判定する。
 */
export function isPathUnder(pathname: string, base: string): boolean {
  if (base === '/') return pathname === '/';
  if (pathname === base) return true;
  return pathname.startsWith(`${base}/`);
}

/** この項目自身がアクティブか */
export function isNavItemActive(href: string, pathname: string): boolean {
  return isPathUnder(pathname, href);
}

/** 子項目のいずれかがアクティブか */
export function hasActiveChild(item: NavItem, pathname: string): boolean {
  return (item.children ?? []).some((child) => isNavItemActive(child.href, pathname));
}

export type NavItemState = {
  /** 親リンク自身を「選択中」表示にするか */
  active: boolean;
  /** 子のいずれかが選択中か（親を開いた状態にするため） */
  childActive: boolean;
  /** 子リストを展開するか */
  expanded: boolean;
};

/**
 * 親項目の表示状態を決める。
 *
 * - 子が選択中のときは親を黒ピルにしない（二重に強調されて今どこにいるか分からない）。
 * - 子が選択中なら必ず展開する（選択中の項目が畳まれて見えないのを防ぐ）。
 * - 手動トグル(manualOpen)があればそれを優先する。呼び出し側はルート変更時に
 *   手動状態を破棄するため、遷移後は常に「選択中の子が見える」状態になる。
 */
export function resolveNavItemState(
  item: NavItem,
  pathname: string,
  manualOpen?: boolean,
): NavItemState {
  const selfActive = isNavItemActive(item.href, pathname);
  const childActive = hasActiveChild(item, pathname);
  return {
    active: selfActive && !childActive,
    childActive,
    expanded: manualOpen ?? (selfActive || childActive),
  };
}

/**
 * サイト設定のトグルに応じてナビ項目を絞り込む。
 *
 * 親が非表示になった場合は子も丸ごと落とす（到達できないリンクを残さない）。
 * 元の NAV_GROUPS は共有定数なので破壊せず、新しい配列を返す。
 */
export function filterNavGroups(
  groups: NavGroup[],
  isVisible: (item: NavItem) => boolean,
): NavGroup[] {
  const filterItems = (items: NavItem[]): NavItem[] =>
    items
      .filter((item) => isVisible(item))
      .map((item) => (item.children ? { ...item, children: filterItems(item.children) } : item));

  return groups
    .map((group) => ({ ...group, items: filterItems(group.items) }))
    .filter((group) => group.items.length > 0);
}
