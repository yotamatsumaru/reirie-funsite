import {
  GALLERY_IMAGE_MAX,
  GALLERY_PREVIEW_COUNT,
  formatImageCounter,
  galleryPreviewImages,
  isValidGalleryImageUrl,
  normalizeGalleryImageUrls,
  remainingImageCount,
  resolveGalleryCover,
  stepIndex,
} from './gallery';

describe('isValidGalleryImageUrl', () => {
  it('http(s) の絶対 URL を受け付ける', () => {
    expect(isValidGalleryImageUrl('https://example.com/a.png')).toBe(true);
    expect(isValidGalleryImageUrl('http://example.com/a.png')).toBe(true);
    expect(isValidGalleryImageUrl('HTTPS://EXAMPLE.COM/A.PNG')).toBe(true);
  });

  it('自サーバの相対パスを受け付ける (回帰: z.url() が弾いて登録できなかった)', () => {
    // S3 未設定環境ではアップロード API がこの形を返す。
    // 共有スキーマの z.array(z.url()) では 400 になっていた。
    expect(isValidGalleryImageUrl('/api/media/content-body-image/abc')).toBe(true);
    expect(isValidGalleryImageUrl('/images/live/01.jpg')).toBe(true);
  });

  it('前後に空白があっても受け付ける', () => {
    expect(isValidGalleryImageUrl('  /a.png  ')).toBe(true);
  });

  it('javascript: / data: / vbscript: を拒否する', () => {
    expect(isValidGalleryImageUrl('javascript:alert(1)')).toBe(false);
    expect(isValidGalleryImageUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isValidGalleryImageUrl('vbscript:msgbox')).toBe(false);
  });

  it('プロトコル相対 URL を拒否する (http ページで意図しないオリジンを読ませない)', () => {
    expect(isValidGalleryImageUrl('//evil.example.com/a.png')).toBe(false);
  });

  it('空文字 / 空白のみ / null / 型違いを拒否する', () => {
    expect(isValidGalleryImageUrl('')).toBe(false);
    expect(isValidGalleryImageUrl('   ')).toBe(false);
    expect(isValidGalleryImageUrl(null)).toBe(false);
    expect(isValidGalleryImageUrl(undefined)).toBe(false);
    expect(isValidGalleryImageUrl(123)).toBe(false);
  });

  it('スキームだけの文字列を拒否する', () => {
    expect(isValidGalleryImageUrl('https://')).toBe(false);
    expect(isValidGalleryImageUrl('http://')).toBe(false);
  });

  it('スキーム無しのホスト名を拒否する', () => {
    expect(isValidGalleryImageUrl('example.com/a.png')).toBe(false);
  });
});

describe('normalizeGalleryImageUrls', () => {
  it('有効な URL をそのまま並べる', () => {
    expect(normalizeGalleryImageUrls(['/a.png', 'https://x.com/b.png'])).toEqual([
      '/a.png',
      'https://x.com/b.png',
    ]);
  });

  it('無効な要素だけを捨てて残りを通す (全体を 400 にしない)', () => {
    // 60 枚のうち 1 枚が壊れただけで全部やり直しは手間が大きすぎる
    expect(normalizeGalleryImageUrls(['/a.png', 'javascript:x', '', '/b.png'])).toEqual([
      '/a.png',
      '/b.png',
    ]);
  });

  it('前後の空白を落とす', () => {
    expect(normalizeGalleryImageUrls(['  /a.png  '])).toEqual(['/a.png']);
  });

  it('重複を除く (同じ写真が 2 度並ぶのを防ぐ)', () => {
    expect(normalizeGalleryImageUrls(['/a.png', '/a.png', '/b.png'])).toEqual([
      '/a.png',
      '/b.png',
    ]);
  });

  it('空白違いの重複も同一とみなす', () => {
    expect(normalizeGalleryImageUrls(['/a.png', ' /a.png '])).toEqual(['/a.png']);
  });

  it('並び順を維持する (運営が並べた順がギャラリーの順序になる)', () => {
    const urls = ['/3.png', '/1.png', '/2.png'];
    expect(normalizeGalleryImageUrls(urls)).toEqual(urls);
  });

  it('上限で切る', () => {
    const many = Array.from({ length: GALLERY_IMAGE_MAX + 10 }, (_, i) => `/img-${i}.png`);
    expect(normalizeGalleryImageUrls(many)).toHaveLength(GALLERY_IMAGE_MAX);
  });

  it('上限を指定できる', () => {
    expect(normalizeGalleryImageUrls(['/a.png', '/b.png', '/c.png'], 2)).toEqual([
      '/a.png',
      '/b.png',
    ]);
  });

  it('配列以外は空配列', () => {
    expect(normalizeGalleryImageUrls(null)).toEqual([]);
    expect(normalizeGalleryImageUrls('x')).toEqual([]);
    expect(normalizeGalleryImageUrls(undefined)).toEqual([]);
  });

  it('空配列を渡すと空配列 (全画像削除の意思表示として使える)', () => {
    expect(normalizeGalleryImageUrls([])).toEqual([]);
  });
});

describe('resolveGalleryCover', () => {
  it('カバー画像があればそれを使う', () => {
    expect(resolveGalleryCover('/cover.png', [{ url: '/1.png' }])).toBe('/cover.png');
  });

  it('カバーが無ければ 1 枚目の写真を代表にする', () => {
    // ギャラリーは «写真を並べる» のが目的で、代表を選ぶ手間をかけたくない
    expect(resolveGalleryCover(null, [{ url: '/1.png' }, { url: '/2.png' }])).toBe('/1.png');
  });

  it('カバーが空文字でも 1 枚目にフォールバックする', () => {
    expect(resolveGalleryCover('', [{ url: '/1.png' }])).toBe('/1.png');
    expect(resolveGalleryCover('   ', [{ url: '/1.png' }])).toBe('/1.png');
  });

  it('1 枚目が無効な URL なら次の有効な写真を使う', () => {
    expect(resolveGalleryCover(null, [{ url: 'javascript:x' }, { url: '/2.png' }])).toBe('/2.png');
  });

  it('写真が無ければ null', () => {
    expect(resolveGalleryCover(null, [])).toBeNull();
    expect(resolveGalleryCover(null, null)).toBeNull();
  });

  it('カバーの前後の空白を落とす', () => {
    expect(resolveGalleryCover('  /cover.png  ', [])).toBe('/cover.png');
  });
});

describe('galleryPreviewImages', () => {
  it('先頭から既定枚数を返す', () => {
    const imgs = Array.from({ length: 10 }, (_, i) => ({ url: `/${i}.png` }));
    expect(galleryPreviewImages(imgs)).toHaveLength(GALLERY_PREVIEW_COUNT);
    expect(galleryPreviewImages(imgs)[0]).toBe('/0.png');
  });

  it('枚数が少なければあるだけ返す', () => {
    expect(galleryPreviewImages([{ url: '/a.png' }])).toEqual(['/a.png']);
  });

  it('無効な URL は除外する', () => {
    expect(galleryPreviewImages([{ url: 'javascript:x' }, { url: '/a.png' }])).toEqual(['/a.png']);
  });

  it('枚数を指定できる', () => {
    const imgs = [{ url: '/a.png' }, { url: '/b.png' }, { url: '/c.png' }];
    expect(galleryPreviewImages(imgs, 2)).toEqual(['/a.png', '/b.png']);
  });

  it('null / 空は空配列', () => {
    expect(galleryPreviewImages(null)).toEqual([]);
    expect(galleryPreviewImages([])).toEqual([]);
  });
});

describe('remainingImageCount', () => {
  it('プレビューに出しきれない残り枚数を返す', () => {
    expect(remainingImageCount(10, 4)).toBe(6);
  });

  it('ちょうど収まるなら null', () => {
    expect(remainingImageCount(4, 4)).toBeNull();
  });

  it('少なければ null', () => {
    expect(remainingImageCount(2, 4)).toBeNull();
    expect(remainingImageCount(0, 4)).toBeNull();
  });

  it('既定は GALLERY_PREVIEW_COUNT', () => {
    expect(remainingImageCount(GALLERY_PREVIEW_COUNT + 3)).toBe(3);
  });
});

describe('stepIndex', () => {
  it('次へ進む', () => {
    expect(stepIndex(0, 1, 5)).toBe(1);
  });

  it('前へ戻る', () => {
    expect(stepIndex(3, -1, 5)).toBe(2);
  });

  it('末尾から次へ進むと先頭に循環する (操作が止まらないように)', () => {
    expect(stepIndex(4, 1, 5)).toBe(0);
  });

  it('先頭から前へ戻ると末尾に循環する', () => {
    expect(stepIndex(0, -1, 5)).toBe(4);
  });

  it('1 枚しか無いときは動かない', () => {
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, -1, 1)).toBe(0);
  });

  it('0 枚のときは 0 (配列外アクセスで落ちないように)', () => {
    expect(stepIndex(0, 1, 0)).toBe(0);
    expect(stepIndex(5, -1, 0)).toBe(0);
  });

  it('大きな delta でも範囲内に収まる', () => {
    for (const d of [7, -7, 100, -100]) {
      const r = stepIndex(2, d, 5);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(5);
    }
  });
});

describe('formatImageCounter', () => {
  it('1 始まりで表示する', () => {
    expect(formatImageCounter(0, 12)).toBe('1 / 12');
    expect(formatImageCounter(11, 12)).toBe('12 / 12');
  });

  it('範囲外の添字は端に丸める (壊れた表示を出さない)', () => {
    expect(formatImageCounter(-1, 5)).toBe('1 / 5');
    expect(formatImageCounter(99, 5)).toBe('5 / 5');
  });

  it('0 枚のときは 0 / 0', () => {
    expect(formatImageCounter(0, 0)).toBe('0 / 0');
  });
});
