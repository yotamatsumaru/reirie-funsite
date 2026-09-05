/**
 * サイドバーのナビ構造 / アクティブ判定のテスト。
 *
 * 目的:
 *   1. 「ブログ」「動画」がトップレベルに並列で存在することを固定する。
 *      かつては「コンテンツ」を親とする入れ子だったが、
 *      2 クリック必要・親と子の内容が重複する、という理由で廃止した。
 *      再び入れ子に戻す変更や、うっかり片方を消す変更を検知する。
 *   2. ナビに「コンテンツ」項目が復活しないこと。
 *   3. 「ブログ・動画」を非表示にしたとき、両方が消えること。
 *      片方だけ残ると、OFF なのにクリックできて 404 になる。
 *   4. ナビの href にクエリを含めないこと（回帰テスト）。
 *      クエリ付きにするとアクティブ判定で useSearchParams() が必要になり、
 *      サイドバーは全ページに入っているため静的プリレンダリングが全滅する。
 *   5. 入れ子の仕組み (children / resolveNavItemState) は将来のために
 *      残してあるので、未使用でも壊れていないこと。
 */
import {
  NAV_GROUPS,
  filterNavGroups,
  hasActiveChild,
  isNavItemActive,
  isPathUnder,
  resolveNavItemState,
  type NavItem,
} from './site-nav';

function allItems(): NavItem[] {
  return NAV_GROUPS.flatMap((g) => g.items.flatMap((i) => [i, ...(i.children ?? [])]));
}

function findItem(href: string): NavItem {
  const found = allItems().find((i) => i.href === href);
  if (!found) throw new Error(`nav item not found: ${href}`);
  return found;
}

function topLevelHrefs(): string[] {
  return NAV_GROUPS.flatMap((g) => g.items).map((i) => i.href);
}

describe('NAV_GROUPS の構造', () => {
  it('「ブログ」がトップレベルに存在する', () => {
    expect(topLevelHrefs()).toContain('/blog');
  });

  it('「動画」がトップレベルに存在する', () => {
    expect(topLevelHrefs()).toContain('/me/videos');
  });

  it('「コンテンツ」項目は存在しない (回帰: 親項目を廃止した)', () => {
    expect(topLevelHrefs()).not.toContain('/contents');
    expect(allItems().map((i) => i.label)).not.toContain('コンテンツ');
  });

  it('ブログ・動画はどちらも入れ子になっていない (親を挟むと 1 クリック増える)', () => {
    expect(findItem('/blog').children).toBeUndefined();
    expect(findItem('/me/videos').children).toBeUndefined();
  });

  it('ナビ全体に入れ子が存在しない (現構成はフラット)', () => {
    for (const item of NAV_GROUPS.flatMap((g) => g.items)) {
      expect(item.children ?? []).toHaveLength(0);
    }
  });

  it('動画のリンク先は既存の /me/videos を維持している', () => {
    expect(findItem('/me/videos').label).toBe('動画');
  });

  it('ブログのリンク先は専用ルート /blog', () => {
    expect(findItem('/blog').label).toBe('ブログ');
  });

  it('ブログは動画より前に並ぶ (更新頻度が高い導線を上に置く)', () => {
    const hrefs = topLevelHrefs();
    expect(hrefs.indexOf('/blog')).toBeLessThan(hrefs.indexOf('/me/videos'));
  });

  it('ホームが先頭にある', () => {
    expect(topLevelHrefs()[0]).toBe('/');
  });

  it('メニュー / ショップのグループは維持されている', () => {
    expect(NAV_GROUPS.map((g) => g.title)).toEqual(['メニュー', 'ショップ']);
  });

  it('ホーム・ゲーム・お知らせ・グッズ・プラン・カートは従来どおり存在する', () => {
    expect(topLevelHrefs()).toEqual(
      expect.arrayContaining(['/', '/game', '/notices', '/products', '/plans', '/cart']),
    );
  });

  it('カートのバッジ設定は失われていない', () => {
    expect(findItem('/cart').badge).toBe('cart');
  });

  it('href にクエリを含めない (回帰: useSearchParams でビルドが壊れた)', () => {
    for (const item of allItems()) {
      expect(item.href).not.toContain('?');
    }
  });

  it('全項目の href は絶対パス (相対パスだと現在地によってリンク先が変わる)', () => {
    for (const item of allItems()) {
      expect(item.href.startsWith('/')).toBe(true);
    }
  });

  it('href の重複が無い (React の key 衝突と二重点灯を防ぐ)', () => {
    const hrefs = allItems().map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('ラベルの重複が無い (同じ名前が 2 つ並ぶと選べない)', () => {
    const labels = allItems().map((i) => i.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('isPathUnder', () => {
  it('ルートは完全一致のみ (前方一致にすると全ページで点灯する)', () => {
    expect(isPathUnder('/', '/')).toBe(true);
    expect(isPathUnder('/blog', '/')).toBe(false);
  });

  it('完全一致', () => {
    expect(isPathUnder('/blog', '/blog')).toBe(true);
  });

  it('配下のパス', () => {
    expect(isPathUnder('/me/videos/abc', '/me/videos')).toBe(true);
  });

  it('セグメント境界を無視した部分一致は false (回帰: 素の startsWith だと true)', () => {
    expect(isPathUnder('/contentsomething', '/contents')).toBe(false);
    expect(isPathUnder('/blogs', '/blog')).toBe(false);
  });
});

describe('isNavItemActive', () => {
  it('自身のページでアクティブ', () => {
    expect(isNavItemActive('/blog', '/blog')).toBe(true);
  });

  it('配下の詳細ページでもアクティブ', () => {
    expect(isNavItemActive('/me/videos', '/me/videos/abc')).toBe(true);
  });

  it('別ページでは false', () => {
    expect(isNavItemActive('/blog', '/game')).toBe(false);
  });

  it('記事詳細 (/contents/[slug]) ではどのナビ項目も点灯しない', () => {
    // 記事詳細のルートは /contents/[slug] だが、/contents はナビから外した。
    // ブログ一覧を点灯させたいところだが、href が異なるため点灯しない。
    // これは既知の割り切り (記事詳細は共有 URL 互換のためルートを変えられない)。
    for (const item of allItems()) {
      expect(isNavItemActive(item.href, '/contents/my-post')).toBe(false);
    }
  });

  it('動画は /me 配下だが、マイページ用の項目とは独立している', () => {
    // /me/videos は「動画」項目のもの。会員メニュー (MEMBER_ITEMS) は
    // Sidebar 側の別配列なので、ここでの重複点灯は起きない。
    expect(isNavItemActive('/me/videos', '/me')).toBe(false);
  });
});

describe('hasActiveChild', () => {
  it('子を持たない項目は常に false (現構成は全てフラット)', () => {
    for (const item of NAV_GROUPS.flatMap((g) => g.items)) {
      expect(hasActiveChild(item, item.href)).toBe(false);
    }
  });

  it('children を持つ項目を渡せば従来どおり判定できる (将来の再階層化用)', () => {
    const parent: NavItem = {
      href: '/parent',
      label: '親',
      iconKey: 'home',
      children: [{ href: '/child', label: '子', iconKey: 'blog' }],
    };
    expect(hasActiveChild(parent, '/child')).toBe(true);
    expect(hasActiveChild(parent, '/parent')).toBe(false);
  });
});

describe('resolveNavItemState', () => {
  it('フラットな項目は自身のページでアクティブになる', () => {
    const s = resolveNavItemState(findItem('/blog'), '/blog');
    expect(s.active).toBe(true);
    expect(s.childActive).toBe(false);
  });

  it('フラットな項目は無関係なページで非アクティブ', () => {
    const s = resolveNavItemState(findItem('/blog'), '/game');
    expect(s.active).toBe(false);
    expect(s.childActive).toBe(false);
  });

  it('動画は詳細ページでもアクティブのまま', () => {
    expect(resolveNavItemState(findItem('/me/videos'), '/me/videos/abc').active).toBe(true);
  });

  // 以下は入れ子の仕組みが壊れていないことの確認 (将来の再階層化に備える)
  const parent: NavItem = {
    href: '/parent',
    label: '親',
    iconKey: 'home',
    children: [{ href: '/child', label: '子', iconKey: 'blog' }],
  };

  it('入れ子: 子のページでは親を点灯させない', () => {
    const s = resolveNavItemState(parent, '/child');
    expect(s.active).toBe(false);
    expect(s.childActive).toBe(true);
    expect(s.expanded).toBe(true);
  });

  it('入れ子: 手動トグルは自動判定より優先される', () => {
    expect(resolveNavItemState(parent, '/other', true).expanded).toBe(true);
    expect(resolveNavItemState(parent, '/parent', false).expanded).toBe(false);
  });

  it('入れ子: 親と子が同時に点灯することはない', () => {
    for (const path of ['/parent', '/child', '/other']) {
      const s = resolveNavItemState(parent, path);
      expect(s.active && s.childActive).toBe(false);
    }
  });
});

describe('filterNavGroups', () => {
  /**
   * Sidebar.tsx の判定を再現する。
   * contentsVisible が OFF のとき、ブログと動画の *両方* を落とす必要がある。
   * かつては親 /contents 1 つを落とせば子も消えたが、
   * 並列にしたので個別に判定しないと片方が残ってしまう。
   */
  function hideContents() {
    return filterNavGroups(
      NAV_GROUPS,
      (item) => item.href !== '/blog' && item.href !== '/me/videos',
    );
  }

  it('ブログ・動画を非表示にすると両方消える', () => {
    const hrefs = hideContents().flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).not.toContain('/blog');
    expect(hrefs).not.toContain('/me/videos');
  });

  it('ブログ・動画を非表示にしても他の項目は残る', () => {
    const hrefs = hideContents().flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toEqual(expect.arrayContaining(['/', '/game', '/notices', '/products']));
  });

  it('片方だけ非表示にできる (回帰: 一方だけ残して 404 にしない確認用)', () => {
    const groups = filterNavGroups(NAV_GROUPS, (item) => item.href !== '/me/videos');
    const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain('/blog');
    expect(hrefs).not.toContain('/me/videos');
  });

  it('項目が全て消えたグループは丸ごと落ちる', () => {
    const groups = filterNavGroups(
      NAV_GROUPS,
      (item) => !['/products', '/plans', '/cart'].includes(item.href),
    );
    expect(groups.map((g) => g.title)).toEqual(['メニュー']);
  });

  it('全て表示なら元の構造と同じ href 一覧になる', () => {
    const groups = filterNavGroups(NAV_GROUPS, () => true);
    expect(groups.flatMap((g) => g.items).map((i) => i.href)).toEqual(topLevelHrefs());
  });

  it('元の NAV_GROUPS を破壊しない (共有定数なので変更されると全ページに影響する)', () => {
    const before = JSON.stringify(NAV_GROUPS);
    filterNavGroups(NAV_GROUPS, (item) => item.href !== '/me/videos');
    expect(JSON.stringify(NAV_GROUPS)).toBe(before);
  });

  it('children を持つ構造を渡しても再帰的に絞り込める (将来の再階層化用)', () => {
    const groups = filterNavGroups(
      [
        {
          title: 'テスト',
          items: [
            {
              href: '/parent',
              label: '親',
              iconKey: 'home',
              children: [
                { href: '/child-a', label: 'A', iconKey: 'blog' },
                { href: '/child-b', label: 'B', iconKey: 'video' },
              ],
            },
          ],
        },
      ],
      (item) => item.href !== '/child-b',
    );
    expect(groups[0]!.items[0]!.children!.map((c) => c.href)).toEqual(['/child-a']);
  });
});
