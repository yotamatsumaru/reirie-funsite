import { buildGalleryImages } from './gallery-images';

describe('buildGalleryImages', () => {
  it('URL だけならキャプションは null', () => {
    expect(buildGalleryImages(['/a.png', '/b.png'])).toEqual([
      { url: '/a.png', caption: null },
      { url: '/b.png', caption: null },
    ]);
  });

  it('キャプションを同じ順序で対応づける', () => {
    expect(buildGalleryImages(['/a.png', '/b.png'], ['1枚目', '2枚目'])).toEqual([
      { url: '/a.png', caption: '1枚目' },
      { url: '/b.png', caption: '2枚目' },
    ]);
  });

  it('無効な URL を挟んでもキャプションがズレない (重要)', () => {
    // 正規化は無効な URL を捨てるので、添字をそのまま使うと
    // 「/b.png に 3枚目 のキャプション」が付いてしまう。
    expect(
      buildGalleryImages(
        ['/a.png', 'javascript:x', '/b.png'],
        ['Aのキャプション', '捨てられる', 'Bのキャプション'],
      ),
    ).toEqual([
      { url: '/a.png', caption: 'Aのキャプション' },
      { url: '/b.png', caption: 'Bのキャプション' },
    ]);
  });

  it('空文字の URL を挟んでもズレない', () => {
    expect(buildGalleryImages(['/a.png', '', '/b.png'], ['A', 'x', 'B'])).toEqual([
      { url: '/a.png', caption: 'A' },
      { url: '/b.png', caption: 'B' },
    ]);
  });

  it('キャプションが足りなくても落ちない', () => {
    expect(buildGalleryImages(['/a.png', '/b.png'], ['A'])).toEqual([
      { url: '/a.png', caption: 'A' },
      { url: '/b.png', caption: null },
    ]);
  });

  it('キャプションが多くても余りは無視する', () => {
    expect(buildGalleryImages(['/a.png'], ['A', 'B', 'C'])).toEqual([
      { url: '/a.png', caption: 'A' },
    ]);
  });

  it('空文字・空白のみのキャプションは null にする', () => {
    expect(buildGalleryImages(['/a.png', '/b.png'], ['', '   '])).toEqual([
      { url: '/a.png', caption: null },
      { url: '/b.png', caption: null },
    ]);
  });

  it('キャプションの前後の空白を落とす', () => {
    expect(buildGalleryImages(['/a.png'], ['  A  '])).toEqual([{ url: '/a.png', caption: 'A' }]);
  });

  it('重複 URL は 1 つに畳まれ、最初のキャプションを採用する', () => {
    expect(buildGalleryImages(['/a.png', '/a.png'], ['最初', '後'])).toEqual([
      { url: '/a.png', caption: '最初' },
    ]);
  });

  it('キャプションが配列でなければ全て null', () => {
    expect(buildGalleryImages(['/a.png'], 'A')).toEqual([{ url: '/a.png', caption: null }]);
    expect(buildGalleryImages(['/a.png'], null)).toEqual([{ url: '/a.png', caption: null }]);
  });

  it('URL が配列でなければ空配列', () => {
    expect(buildGalleryImages(null)).toEqual([]);
    expect(buildGalleryImages(undefined, ['A'])).toEqual([]);
  });

  it('空配列は空配列 (全画像削除の意思表示)', () => {
    expect(buildGalleryImages([])).toEqual([]);
  });

  it('相対パスと絶対 URL が混在してもよい', () => {
    expect(
      buildGalleryImages(['/api/media/content-body-image/x', 'https://cdn.example.com/y.jpg']),
    ).toEqual([
      { url: '/api/media/content-body-image/x', caption: null },
      { url: 'https://cdn.example.com/y.jpg', caption: null },
    ]);
  });

  it('並び順は入力順を維持する (運営が並べた順が表示順になる)', () => {
    const r = buildGalleryImages(['/3.png', '/1.png', '/2.png']);
    expect(r.map((i) => i.url)).toEqual(['/3.png', '/1.png', '/2.png']);
  });
});
