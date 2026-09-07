import {
  ALBUM_NAME_MAX,
  UNGROUPED_ALBUM_KEY,
  UNGROUPED_ALBUM_LABEL,
  albumDisplayName,
  albumFilterWhere,
  groupByAlbum,
  isSelectedAlbum,
  isUngrouped,
  normalizeAlbumName,
} from './gallery-album';

describe('normalizeAlbumName', () => {
  it('前後の空白を落とす', () => {
    expect(normalizeAlbumName('  2026 春ツアー  ')).toBe('2026 春ツアー');
  });

  it('null / undefined / 空文字 / 空白のみ はすべて null（未設定）', () => {
    // 空文字と NULL を別グループにすると、入力欄を空にして保存した
    // ギャラリーと未入力のギャラリーが別のタブに分かれてしまう。
    expect(normalizeAlbumName(null)).toBeNull();
    expect(normalizeAlbumName(undefined)).toBeNull();
    expect(normalizeAlbumName('')).toBeNull();
    expect(normalizeAlbumName('   ')).toBeNull();
    expect(normalizeAlbumName('\t\n ')).toBeNull();
  });

  it('最大長で切り詰める', () => {
    const long = 'あ'.repeat(ALBUM_NAME_MAX + 20);
    expect(normalizeAlbumName(long)).toHaveLength(ALBUM_NAME_MAX);
  });

  it('中の空白は保持する（「2026 春ツアー」を潰さない）', () => {
    expect(normalizeAlbumName('2026 春 ツアー')).toBe('2026 春 ツアー');
  });
});

describe('isUngrouped / albumDisplayName', () => {
  it('未設定を判定できる', () => {
    expect(isUngrouped(null)).toBe(true);
    expect(isUngrouped('  ')).toBe(true);
    expect(isUngrouped('ライブ')).toBe(false);
  });

  it('未設定は「その他」と表示する', () => {
    expect(albumDisplayName(null)).toBe(UNGROUPED_ALBUM_LABEL);
    expect(albumDisplayName('')).toBe(UNGROUPED_ALBUM_LABEL);
    expect(albumDisplayName('ライブ')).toBe('ライブ');
  });
});

describe('groupByAlbum', () => {
  const g = (album: string | null, id: string) => ({ album, id });

  it('同じアルバム名がまとまる', () => {
    const groups = groupByAlbum([
      g('ツアー', 'a'),
      g('撮影会', 'b'),
      g('ツアー', 'c'),
    ]);
    expect(groups.map((x) => x.name)).toEqual(['ツアー', '撮影会']);
    expect(groups[0]!.items.map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('渡された順（=新しい順）でアルバムが並ぶ', () => {
    // 名前順にすると「2024…」が「2026…」より先に来て、
    // 最新の写真が下に埋もれる。
    const groups = groupByAlbum([g('2026 春', 'a'), g('2024 冬', 'b')]);
    expect(groups.map((x) => x.name)).toEqual(['2026 春', '2024 冬']);
  });

  it('未設定は必ず末尾の「その他」にまとまる', () => {
    const groups = groupByAlbum([
      g(null, 'a'),
      g('ツアー', 'b'),
      g('  ', 'c'),
    ]);
    expect(groups.map((x) => x.name)).toEqual(['ツアー', UNGROUPED_ALBUM_LABEL]);
    expect(groups[1]!.items.map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('未設定が無いときは「その他」グループを作らない', () => {
    const groups = groupByAlbum([g('ツアー', 'a')]);
    expect(groups).toHaveLength(1);
    expect(groups.some((x) => x.name === UNGROUPED_ALBUM_LABEL)).toBe(false);
  });

  it('空配列なら空配列', () => {
    expect(groupByAlbum([])).toEqual([]);
  });

  it('未設定グループの key は URL 用の予約語になる', () => {
    const groups = groupByAlbum([g(null, 'a')]);
    expect(groups[0]!.key).toBe(UNGROUPED_ALBUM_KEY);
  });

  it('名前付きグループの key はアルバム名そのもの', () => {
    const groups = groupByAlbum([g('ツアー', 'a')]);
    expect(groups[0]!.key).toBe('ツアー');
  });

  it('全件がどこかのグループに入る（取りこぼさない）', () => {
    const items = [g('A', '1'), g(null, '2'), g('B', '3'), g('A', '4'), g('', '5')];
    const groups = groupByAlbum(items);
    const total = groups.reduce((n, x) => n + x.items.length, 0);
    expect(total).toBe(items.length);
  });

  it('前後の空白違いは同じアルバムとして扱う', () => {
    const groups = groupByAlbum([g('ツアー', 'a'), g(' ツアー ', 'b')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items).toHaveLength(2);
  });
});

describe('albumFilterWhere', () => {
  it('未指定・空文字は絞り込みなし', () => {
    expect(albumFilterWhere(null)).toBeUndefined();
    expect(albumFilterWhere(undefined)).toBeUndefined();
    expect(albumFilterWhere('')).toBeUndefined();
    expect(albumFilterWhere('   ')).toBeUndefined();
  });

  it('予約語なら album IS NULL で絞る', () => {
    expect(albumFilterWhere(UNGROUPED_ALBUM_KEY)).toEqual({ album: null });
  });

  it('通常のアルバム名で絞る', () => {
    expect(albumFilterWhere('ツアー')).toEqual({ album: 'ツアー' });
  });

  it('存在しないアルバム名でもエラーにせず条件を返す（0 件になるだけ）', () => {
    // URL を直接編集された場合に 500 にしたくない。
    expect(albumFilterWhere('存在しない')).toEqual({ album: '存在しない' });
  });

  it('空白付きで来ても正規化して絞る', () => {
    expect(albumFilterWhere('  ツアー  ')).toEqual({ album: 'ツアー' });
  });
});

describe('isSelectedAlbum', () => {
  it('絞り込みなしのときはどのタブも選択中にしない', () => {
    expect(isSelectedAlbum(null, 'ツアー')).toBe(false);
    expect(isSelectedAlbum('', 'ツアー')).toBe(false);
    expect(isSelectedAlbum('  ', 'ツアー')).toBe(false);
  });

  it('一致するタブだけ選択中', () => {
    expect(isSelectedAlbum('ツアー', 'ツアー')).toBe(true);
    expect(isSelectedAlbum('ツアー', '撮影会')).toBe(false);
  });

  it('未設定グループも選択できる', () => {
    expect(isSelectedAlbum(UNGROUPED_ALBUM_KEY, UNGROUPED_ALBUM_KEY)).toBe(true);
  });
});
