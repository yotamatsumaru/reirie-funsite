/**
 * サイドバーのナビ構造 / アクティブ判定のテスト。
 *
 * 目的:
 *   1. 「動画」「ブログ」が必ず「コンテンツ」の子として存在することを固定する。
 *      フラットに戻すリファクタや、うっかり子を消す変更を検知する。
 *   2. 子ページにいるとき、親（コンテンツ）と子（動画）が二重に点灯しないこと。
 *   3. コンテンツを非表示にしたとき、配下のブログ / 動画も消えること。
 *      親だけ消して子が残ると、親から辿れないリンクが残る。
 *   4. ナビの href にクエリを含めないこと（回帰テスト）。
 *      クエリ付きにするとアクティブ判定で useSearchParams() が必要になり、
 *      サイドバーは全ページに入っているため静的プリレンダリングが全滅する。
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

describe('NAV_GROUPS の構造', () => {
  const contents = findItem('/contents');

  it('「コンテンツ」が子項目を持つ', () => {
    expect(contents.children).toBeDefined();
    expect(contents.children!.length).toBeGreaterThan(0);
  });

  it('「動画」はコンテンツの子である (回帰: 以前はトップレベルの兄弟だった)', () => {
    expect(contents.children!.map((c) => c.label)).toContain('動画');
  });

  it('「ブログ」がコンテンツの子として追加されている (以前はナビに存在しなかった)', () => {
    expect(contents.children!.map((c) => c.label)).toContain('ブログ');
  });

  it('動画のリンク先は既存の /me/videos を維持している', () => {
    expect(contents.children!.find((c) => c.label === '動画')?.href).toBe('/me/videos');
  });

  it('ブログのリンク先は専用ルート /blog', () => {
    expect(contents.children!.find((c) => c.label === 'ブログ')?.href).toBe('/blog');
  });

  it('「動画」「ブログ」がトップレベルに残っていない (二重に出さない)', () => {
    const topLevel = NAV_GROUPS.flatMap((g) => g.items).map((i) => i.label);
    expect(topLevel).not.toContain('動画');
    expect(topLevel).not.toContain('ブログ');
  });

  it('メニュー / ショップのグループは維持されている', () => {
    expect(NAV_GROUPS.map((g) => g.title)).toEqual(['メニュー', 'ショップ']);
  });

  it('ホーム・ゲーム・お知らせ・グッズ・プラン・カートは従来どおり存在する', () => {
    const hrefs = NAV_GROUPS.flatMap((g) => g.items).map((i) => i.href);
    expect(hrefs).toEqual(
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
});

describe('isPathUnder', () => {
  it('ルートは完全一致のみ (前方一致にすると全ページで点灯する)', () => {
    expect(isPathUnder('/', '/')).toBe(true);
    expect(isPathUnder('/contents', '/')).toBe(false);
  });

  it('完全一致', () => {
    expect(isPathUnder('/contents', '/contents')).toBe(true);
  });

  it('配下のパス', () => {
    expect(isPathUnder('/contents/my-post', '/contents')).toBe(true);
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
    expect(isNavItemActive('/contents', '/game')).toBe(false);
  });

  it('ブログの記事詳細 (/contents/[slug]) はコンテンツ側が拾う', () => {
    // 記事詳細のルートは /contents/[slug] なので、ブログ一覧ではなく
    // 親のコンテンツが点灯する。これは意図した挙動。
    expect(isNavItemActive('/blog', '/contents/my-post')).toBe(false);
    expect(isNavItemActive('/contents', '/contents/my-post')).toBe(true);
  });
});

describe('hasActiveChild', () => {
  const contents = findItem('/contents');

  it('動画ページでは子がアクティブ', () => {
    expect(hasActiveChild(contents, '/me/videos')).toBe(true);
  });

  it('動画の詳細ページでも子がアクティブ', () => {
    expect(hasActiveChild(contents, '/me/videos/abc')).toBe(true);
  });

  it('ブログページでは子がアクティブ', () => {
    expect(hasActiveChild(contents, '/blog')).toBe(true);
  });

  it('コンテンツ一覧そのものでは子はアクティブでない', () => {
    expect(hasActiveChild(contents, '/contents')).toBe(false);
  });

  it('子を持たない項目は常に false', () => {
    expect(hasActiveChild(findItem('/game'), '/game')).toBe(false);
  });
});

describe('resolveNavItemState', () => {
  const contents = findItem('/contents');

  it('コンテンツ一覧では親がアクティブで、子リストは開く', () => {
    const s = resolveNavItemState(contents, '/contents');
    expect(s.active).toBe(true);
    expect(s.childActive).toBe(false);
    expect(s.expanded).toBe(true);
  });

  it('ブログページでは親を点灯させない (子だけを点灯させる)', () => {
    const s = resolveNavItemState(contents, '/blog');
    expect(s.active).toBe(false);
    expect(s.childActive).toBe(true);
    expect(s.expanded).toBe(true);
  });

  it('動画ページでは親は点灯しないが子リストは開いている', () => {
    const s = resolveNavItemState(contents, '/me/videos');
    expect(s.active).toBe(false);
    expect(s.childActive).toBe(true);
    // 選択中の子が畳まれて見えなくなるのを防ぐ
    expect(s.expanded).toBe(true);
  });

  it('無関係なページでは閉じている', () => {
    const s = resolveNavItemState(contents, '/game');
    expect(s.active).toBe(false);
    expect(s.childActive).toBe(false);
    expect(s.expanded).toBe(false);
  });

  it('手動トグルは自動判定より優先される', () => {
    expect(resolveNavItemState(contents, '/game', true).expanded).toBe(true);
    expect(resolveNavItemState(contents, '/contents', false).expanded).toBe(false);
  });

  it('手動トグルで閉じても、子のアクティブ判定自体は変わらない', () => {
    const s = resolveNavItemState(contents, '/me/videos', false);
    expect(s.childActive).toBe(true);
    expect(s.expanded).toBe(false);
  });

  it('親と子が同時に点灯することはない', () => {
    for (const path of ['/contents', '/blog', '/me/videos', '/contents/post-1']) {
      const s = resolveNavItemState(contents, path);
      expect(s.active && s.childActive).toBe(false);
    }
  });
});

describe('filterNavGroups', () => {
  it('コンテンツを非表示にすると配下のブログ / 動画も消える', () => {
    const groups = filterNavGroups(NAV_GROUPS, (item) => item.href !== '/contents');
    const hrefs = groups.flatMap((g) =>
      g.items.flatMap((i) => [i.href, ...(i.children ?? []).map((c) => c.href)]),
    );
    expect(hrefs).not.toContain('/contents');
    // 親が落ちれば子も辿れないので丸ごと消える
    expect(hrefs).not.toContain('/me/videos');
    expect(hrefs).not.toContain('/blog');
  });

  it('子だけを非表示にでき、親は残る', () => {
    const groups = filterNavGroups(NAV_GROUPS, (item) => item.href !== '/me/videos');
    const contents = groups.flatMap((g) => g.items).find((i) => i.href === '/contents');
    expect(contents).toBeDefined();
    expect(contents!.children!.map((c) => c.href)).toEqual(['/blog']);
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
    expect(groups.flatMap((g) => g.items).map((i) => i.href)).toEqual(
      NAV_GROUPS.flatMap((g) => g.items).map((i) => i.href),
    );
  });

  it('全て表示なら子の構造も維持される', () => {
    const groups = filterNavGroups(NAV_GROUPS, () => true);
    const contents = groups.flatMap((g) => g.items).find((i) => i.href === '/contents');
    expect(contents!.children!.map((c) => c.href)).toEqual(['/blog', '/me/videos']);
  });

  it('元の NAV_GROUPS を破壊しない (共有定数なので変更されると全ページに影響する)', () => {
    const before = JSON.stringify(NAV_GROUPS);
    filterNavGroups(NAV_GROUPS, (item) => item.href !== '/me/videos');
    expect(JSON.stringify(NAV_GROUPS)).toBe(before);
  });
});
