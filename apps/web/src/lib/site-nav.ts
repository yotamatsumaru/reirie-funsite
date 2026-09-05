/**
 * サイドバー（メインナビ）の構造と、アクティブ判定 / 開閉判定。
 *
 * ## なぜ別ファイルに切り出すか
 *
 * Sidebar.tsx は 'use client' コンポーネントで、jest の設定が
 * `testMatch: ['**\/*.test.ts']`（.tsx は対象外）のためテストが書けない。
 * 「どの項目がどの階層にあるか」「今どのリンクがアクティブか」は
 * 一度崩れると全ページで導線が壊れる箇所なので、純粋関数としてここに集約し
 * 単体テストで固定する（lib/admin-nav.ts と同じ方針）。
 *
 * ## 「コンテンツ」を親にするのをやめた経緯（重要）
 *
 * かつては次のような入れ子だった。
 *
 *   コンテンツ (/contents)
 *     ├ ブログ (/blog)
 *     └ 動画   (/me/videos)
 *
 * 「動画もコンテンツの一種なのだから親子にすべき」という分類上の理屈で
 * こうしていたが、実運用では次の問題があった。
 *
 *   1. 見たいものに 2 クリック必要。ブログを開くには
 *      「コンテンツを展開 → ブログ」となり、最も使う導線が最も深い。
 *   2. 親の /contents は「記事 + 動画の混合一覧」で、ブログ /blog とも
 *      動画 /me/videos とも内容が重複する。同じものが 3 か所に出るため
 *      「どれを押せばいいのか」が分かりにくい。
 *   3. 「コンテンツ」という語がサイト上の具体物を指しておらず、
 *      会員から見て中身が想像できない。
 *
 * そこで **ブログと動画をトップレベルに並列で置く** 構成に変更した。
 *
 *   ブログ (/blog)      … 記事のみ
 *   動画   (/me/videos) … 動画のみ
 *
 * ## /contents ページを削除していない理由（重要）
 *
 * ナビからは外したが、ルート自体は残している。
 * 記事の詳細ページが `/contents/[slug]` であり、これは
 *   - 会員に共有された記事 URL
 *   - お知らせメール / SNS に貼られた URL
 *   - 検索エンジンのインデックス
 * として外部に出回っている。`/contents` を消すと記事詳細も巻き添えで
 * 404 になり、既存の共有リンクが全て壊れる。
 * 「メニューから外す」ことと「ページを消す」ことは別の判断なので、
 * ここではナビの構造だけを変更する。
 *
 * ## href にクエリを使わない理由（重要）
 *
 * 当初「ブログ」を `/contents?type=blog` にしたが、アクティブ判定のために
 * Sidebar (= ルートレイアウト) で `useSearchParams()` を呼ぶ必要が生じ、
 * サイドバーが全ページに入っている都合で **静的プリレンダリングが全滅** した
 * (`useSearchParams() should be wrapped in a suspense boundary` でビルド失敗)。
 * そのためナビの href は常にクエリ無しのパスにする。
 *
 * ## children を型から消していない理由
 *
 * 現在の NAV_GROUPS に入れ子は無いが、`children` と
 * `resolveNavItemState()` は残してある。将来また階層が必要になったときに
 * 再実装するより、テスト済みの仕組みを維持するほうが安全なため。
 * 未使用でも壊れないことをテストで保証している。
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
  // 'contents' は「コンテンツ」親項目の廃止に伴い削除した。
  // 型から消しておくことで、Sidebar.tsx の NAV_ICONS に
  // 使われないアイコンが残り続けるのを防ぐ (Record<NavIconKey,...> が型エラーになる)。
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
      // ブログと動画はトップレベルに並列で置く。
      // 「コンテンツ」という親を挟むと 1 クリック増えるうえ、
      // 親 (/contents) の中身が子と重複して選びにくかった。
      { href: '/blog', label: 'ブログ', iconKey: 'blog' },
      // 動画は video テーブルなので専用ページ。
      // 尺・鍵表示など動画向けの一覧はこちらが本体。
      { href: '/me/videos', label: '動画', iconKey: 'video' },
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
