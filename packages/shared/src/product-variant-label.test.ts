import {
  buildOrderLineLabel,
  buildVariantLabel,
  formatSize,
  hasColorOptions,
  hasSizeOptions,
  sizeOrderIndex,
  sortBySize,
} from './product-variant-label';

describe('buildVariantLabel', () => {
  it('【最重要】サイズが必ず含まれる', () => {
    // 以前はサイズが表示から欠落し、どのサイズの注文か分からなかった
    const label = buildVariantLabel({
      name: 'ホワイト',
      optionColor: 'ホワイト',
      optionSize: 'L',
    });
    expect(label).toContain('L');
  });

  it('name と color が同じなら重複させない', () => {
    // 実データが name=ホワイト / optionColor=ホワイト だった
    expect(
      buildVariantLabel({ name: 'ホワイト', optionColor: 'ホワイト', optionSize: 'L' }),
    ).toBe('ホワイト / L');
  });

  it('name・color・size がすべて異なるならすべて出す', () => {
    expect(
      buildVariantLabel({ name: '限定版', optionColor: 'ブラック', optionSize: 'XL' }),
    ).toBe('限定版 / ブラック / XL');
  });

  it('サイズが無い商品は name だけ', () => {
    expect(buildVariantLabel({ name: '通常版', optionColor: null, optionSize: null })).toBe(
      '通常版',
    );
  });

  it('サイズだけある場合も表示できる', () => {
    expect(buildVariantLabel({ name: null, optionColor: null, optionSize: 'M' })).toBe('M');
  });

  it('空文字・空白のみは無視する', () => {
    expect(
      buildVariantLabel({ name: '  ', optionColor: '', optionSize: ' L ' }),
    ).toBe('L');
  });

  it('すべて空なら空文字', () => {
    expect(buildVariantLabel({})).toBe('');
    expect(buildVariantLabel({ name: null, optionColor: null, optionSize: null })).toBe('');
  });

  it('大文字小文字違いの重複も 1 回にまとめる', () => {
    expect(buildVariantLabel({ name: 'White', optionColor: 'WHITE', optionSize: 'S' })).toBe(
      'White / S',
    );
  });
});

describe('buildOrderLineLabel', () => {
  it('商品名とサイズを 1 行で表す', () => {
    expect(
      buildOrderLineLabel('REIRIE ロゴTシャツ', {
        name: 'ホワイト',
        optionColor: 'ホワイト',
        optionSize: 'L',
      }),
    ).toBe('REIRIE ロゴTシャツ / ホワイト / L');
  });

  it('バリエーションが無ければ商品名だけ', () => {
    expect(buildOrderLineLabel('写真集', {})).toBe('写真集');
  });
});

describe('formatSize', () => {
  it('サイズを取り出す', () => {
    expect(formatSize({ optionSize: 'XL' })).toBe('XL');
  });
  it('無ければ null', () => {
    expect(formatSize({ optionSize: null })).toBeNull();
    expect(formatSize({ optionSize: '   ' })).toBeNull();
    expect(formatSize({})).toBeNull();
  });
});

describe('sizeOrderIndex', () => {
  it('標準サイズは S < M < L < XL の順', () => {
    const s = sizeOrderIndex('S')!;
    const m = sizeOrderIndex('M')!;
    const l = sizeOrderIndex('L')!;
    const xl = sizeOrderIndex('XL')!;
    expect(s).toBeLessThan(m);
    expect(m).toBeLessThan(l);
    expect(l).toBeLessThan(xl);
  });

  it('小文字・全角・空白の揺れを吸収する', () => {
    expect(sizeOrderIndex('m')).toBe(sizeOrderIndex('M'));
    expect(sizeOrderIndex('Ｍ')).toBe(sizeOrderIndex('M'));
    expect(sizeOrderIndex(' L ')).toBe(sizeOrderIndex('L'));
    expect(sizeOrderIndex('Mサイズ')).toBe(sizeOrderIndex('M'));
  });

  it('2XL と XXL を同じ並びとして扱える', () => {
    expect(sizeOrderIndex('XXL')).not.toBeNull();
    expect(sizeOrderIndex('2XL')).not.toBeNull();
  });

  it('未知のサイズは null', () => {
    expect(sizeOrderIndex('特大')).toBeNull();
    expect(sizeOrderIndex(null)).toBeNull();
    expect(sizeOrderIndex('')).toBeNull();
  });
});

describe('sortBySize', () => {
  it('【回帰】登録順がバラバラでも S→M→L→XL に整列する', () => {
    // 名前順だと L, M, S, XL という直感に反する順になる
    const input = [
      { optionSize: 'XL' },
      { optionSize: 'M' },
      { optionSize: 'S' },
      { optionSize: 'L' },
    ];
    expect(sortBySize(input).map((v) => v.optionSize)).toEqual(['S', 'M', 'L', 'XL']);
  });

  it('元の配列を壊さない（非破壊）', () => {
    const input = [{ optionSize: 'L' }, { optionSize: 'S' }];
    const copy = [...input];
    sortBySize(input);
    expect(input).toEqual(copy);
  });

  it('未知のサイズは既知サイズの後ろへ回す', () => {
    const input = [{ optionSize: '特大' }, { optionSize: 'M' }, { optionSize: 'S' }];
    expect(sortBySize(input).map((v) => v.optionSize)).toEqual(['S', 'M', '特大']);
  });

  it('未知同士は元の順序を保つ（安定ソート）', () => {
    const input = [{ optionSize: 'あ' }, { optionSize: 'い' }, { optionSize: 'う' }];
    expect(sortBySize(input).map((v) => v.optionSize)).toEqual(['あ', 'い', 'う']);
  });

  it('サイズが無い要素があっても落ちない', () => {
    const input = [{ optionSize: null }, { optionSize: 'M' }];
    expect(sortBySize(input).map((v) => v.optionSize)).toEqual(['M', null]);
  });

  it('空配列でも落ちない', () => {
    expect(sortBySize([])).toEqual([]);
  });
});

describe('hasSizeOptions', () => {
  it('サイズが 2 種類以上なら true', () => {
    expect(hasSizeOptions([{ optionSize: 'S' }, { optionSize: 'M' }])).toBe(true);
  });

  it('サイズが 1 種類だけなら false（選ばせる意味が無い）', () => {
    expect(hasSizeOptions([{ optionSize: 'M' }, { optionSize: 'M' }])).toBe(false);
  });

  it('サイズが無い商品は false', () => {
    expect(hasSizeOptions([{ optionSize: null }, { optionSize: null }])).toBe(false);
    expect(hasSizeOptions([])).toBe(false);
  });
});

describe('hasColorOptions', () => {
  it('カラーが 2 種類以上なら true', () => {
    expect(hasColorOptions([{ optionColor: '白' }, { optionColor: '黒' }])).toBe(true);
  });
  it('1 種類なら false', () => {
    expect(hasColorOptions([{ optionColor: '白' }, { optionColor: '白' }])).toBe(false);
  });
});

describe('実データに近いケース', () => {
  const tshirt = [
    { name: 'ホワイト', optionColor: 'ホワイト', optionSize: 'S' },
    { name: 'ホワイト', optionColor: 'ホワイト', optionSize: 'M' },
    { name: 'ホワイト', optionColor: 'ホワイト', optionSize: 'L' },
    { name: 'ブラック', optionColor: 'ブラック', optionSize: 'M' },
    { name: 'ブラック', optionColor: 'ブラック', optionSize: 'XL' },
  ];

  it('Tシャツ 5 種すべてが区別できるラベルになる', () => {
    const labels = tshirt.map(buildVariantLabel);
    expect(labels).toEqual([
      'ホワイト / S',
      'ホワイト / M',
      'ホワイト / L',
      'ブラック / M',
      'ブラック / XL',
    ]);
    // 同じラベルが 2 つ以上あると発送時に取り違える
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('サイズ展開ありと判定される', () => {
    expect(hasSizeOptions(tshirt)).toBe(true);
    expect(hasColorOptions(tshirt)).toBe(true);
  });
});
