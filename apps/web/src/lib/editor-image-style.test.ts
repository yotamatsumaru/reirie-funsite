import {
  buildImageStyle,
  parseImageAlign,
  parseImageWidth,
  IMAGE_WIDTH_PRESETS,
  IMAGE_ALIGN_LABELS,
  type ImageAlign,
} from './editor-image-style';

describe('buildImageStyle', () => {
  it('幅も配置も無ければ null (style 属性を出さない)', () => {
    expect(buildImageStyle(null, null)).toBeNull();
    expect(buildImageStyle(undefined, undefined)).toBeNull();
  });

  it('幅だけ指定すると width のみ出力する', () => {
    expect(buildImageStyle(50, null)).toBe('width: 50%');
  });

  it('中央寄せは margin 両側 auto', () => {
    const style = buildImageStyle(null, 'center');
    expect(style).toContain('display: block');
    expect(style).toContain('margin-left: auto');
    expect(style).toContain('margin-right: auto');
  });

  it('右寄せは margin-left だけ auto', () => {
    const style = buildImageStyle(null, 'right');
    expect(style).toContain('margin-left: auto');
    expect(style).toContain('margin-right: 0');
  });

  it('左寄せは margin-right だけ auto', () => {
    const style = buildImageStyle(null, 'left');
    expect(style).toContain('margin-left: 0');
    expect(style).toContain('margin-right: auto');
  });

  it('幅と配置を同時に出力できる', () => {
    const style = buildImageStyle(75, 'center');
    expect(style).toContain('width: 75%');
    expect(style).toContain('margin-left: auto');
  });

  it('0% や 100% 超の幅は無視する（不正値でレイアウトを壊さない）', () => {
    expect(buildImageStyle(0, null)).toBeNull();
    expect(buildImageStyle(101, null)).toBeNull();
    expect(buildImageStyle(-10, null)).toBeNull();
    expect(buildImageStyle(Number.NaN, null)).toBeNull();
  });

  it('100% は許可する（境界）', () => {
    expect(buildImageStyle(100, null)).toBe('width: 100%');
  });
});

describe('parseImageWidth', () => {
  it('style から % 幅を読み取る', () => {
    expect(parseImageWidth('width: 50%')).toBe(50);
    expect(parseImageWidth('display: block; width:75%; margin-left: auto')).toBe(75);
  });

  it('小数の幅も読み取れる', () => {
    expect(parseImageWidth('width: 33.3%')).toBeCloseTo(33.3);
  });

  it('px 指定は % に変換できないので null', () => {
    expect(parseImageWidth('width: 600px')).toBeNull();
  });

  it('style が無ければ null', () => {
    expect(parseImageWidth(null)).toBeNull();
    expect(parseImageWidth('')).toBeNull();
    expect(parseImageWidth('margin-left: auto')).toBeNull();
  });

  it('範囲外の値は null にする', () => {
    expect(parseImageWidth('width: 0%')).toBeNull();
    expect(parseImageWidth('width: 150%')).toBeNull();
  });
});

describe('parseImageAlign', () => {
  it('両側 auto は中央', () => {
    expect(parseImageAlign('margin-left: auto; margin-right: auto')).toBe('center');
  });

  it('左だけ auto は右寄せ', () => {
    expect(parseImageAlign('margin-left: auto; margin-right: 0')).toBe('right');
  });

  it('右だけ auto は左寄せ', () => {
    expect(parseImageAlign('margin-left: 0; margin-right: auto')).toBe('left');
  });

  it('margin が無ければ null', () => {
    expect(parseImageAlign('width: 50%')).toBeNull();
    expect(parseImageAlign(null)).toBeNull();
  });

  it('両側 0 のような判定できない組み合わせは null', () => {
    expect(parseImageAlign('margin-left: 0; margin-right: 0')).toBeNull();
  });
});

describe('build → parse の往復', () => {
  const aligns: ImageAlign[] = ['left', 'center', 'right'];

  it.each(aligns)('配置 %s は往復しても保たれる', (align) => {
    const style = buildImageStyle(50, align);
    expect(parseImageAlign(style)).toBe(align);
    expect(parseImageWidth(style)).toBe(50);
  });

  it.each(IMAGE_WIDTH_PRESETS)('幅プリセット %i%% は往復しても保たれる', (width) => {
    const style = buildImageStyle(width, 'center');
    expect(parseImageWidth(style)).toBe(width);
  });
});

describe('ラベル', () => {
  it('全ての配置に日本語ラベルがある', () => {
    for (const a of ['left', 'center', 'right'] as ImageAlign[]) {
      expect(IMAGE_ALIGN_LABELS[a]).toBeTruthy();
    }
  });
});
