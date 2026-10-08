import {
  buildOptionsKey,
  countChars,
  formatOptionValues,
  parseOptionValues,
  sumOptionExtra,
  validateOptionInputs,
} from './ec-product-option';

const nameOpt = { id: 'a1', name: '宛名(ニックネーム)', maxLength: 10, price: 0, isRequired: true, sortOrder: 0 };
const wordOpt = { id: 'b2', name: '書いてほしい言葉', maxLength: 6, price: 100, isRequired: false, sortOrder: 1 };
const OPTS = [wordOpt, nameOpt]; // わざと逆順

describe('countChars', () => {
  it('絵文字も 1 文字と数える', () => {
    expect(countChars('れい😊')).toBe(3);
  });
});

describe('validateOptionInputs', () => {
  it('必須が空ならエラー', () => {
    const r = validateOptionInputs(OPTS, { b2: 'ありがとう' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('宛名(ニックネーム)');
  });
  it('文字数超過はエラー', () => {
    const r = validateOptionInputs(OPTS, { a1: 'れいり', b2: 'ありがとうございます' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('6 文字以内');
  });
  it('正常系: sortOrder 順に並び、任意の空は含めず、追加料金を合算', () => {
    const r = validateOptionInputs(OPTS, { a1: ' れいり ', b2: '' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.values).toEqual([{ optionId: 'a1', name: '宛名(ニックネーム)', value: 'れいり', price: 0 }]);
      expect(r.extraPerUnit).toBe(0);
    }
    const r2 = validateOptionInputs(OPTS, { a1: 'れいり', b2: 'ありがとう' });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.values.map((v) => v.optionId)).toEqual(['a1', 'b2']);
      expect(r2.extraPerUnit).toBe(100);
    }
  });
  it('定義に無い optionId は無視する', () => {
    const r = validateOptionInputs(OPTS, { a1: 'れいり', zzz: 'x' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.values).toHaveLength(1);
  });
  it('オプションの無い商品は入力が無くても OK', () => {
    const r = validateOptionInputs([], undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.values).toEqual([]);
  });
});

describe('buildOptionsKey', () => {
  it('入力なしは空文字', () => {
    expect(buildOptionsKey([])).toBe('');
  });
  it('順序に依らず同じ入力なら同じキー', () => {
    const a = buildOptionsKey([
      { optionId: 'b2', name: 'x', value: 'ありがとう', price: 0 },
      { optionId: 'a1', name: 'y', value: 'れいり', price: 0 },
    ]);
    const b = buildOptionsKey([
      { optionId: 'a1', name: 'y', value: 'れいり', price: 0 },
      { optionId: 'b2', name: 'x', value: 'ありがとう', price: 0 },
    ]);
    expect(a).toBe(b);
  });
  it('宛名が違えば別キー', () => {
    const a = buildOptionsKey([{ optionId: 'a1', name: 'y', value: 'れいり', price: 0 }]);
    const b = buildOptionsKey([{ optionId: 'a1', name: 'y', value: 'りえ', price: 0 }]);
    expect(a).not.toBe(b);
  });
});

describe('formatOptionValues / sumOptionExtra / parseOptionValues', () => {
  const vals = [
    { optionId: 'a1', name: '宛名', value: 'れいり', price: 0 },
    { optionId: 'b2', name: '言葉', value: 'ありがとう', price: 100 },
  ];
  it('表示用に連結する', () => {
    expect(formatOptionValues(vals)).toBe('宛名: れいり / 言葉: ありがとう');
    expect(formatOptionValues(null)).toBe('');
  });
  it('追加料金を合算する', () => {
    expect(sumOptionExtra(vals)).toBe(100);
    expect(sumOptionExtra(null)).toBe(0);
  });
  it('JSON からの復元は不正な要素を捨てる', () => {
    expect(parseOptionValues([...vals, { bad: true }, null, 'x'])).toEqual(vals);
    expect(parseOptionValues(null)).toEqual([]);
    expect(parseOptionValues({})).toEqual([]);
  });
  it('price が無ければ 0 とみなす', () => {
    expect(parseOptionValues([{ optionId: 'a', name: 'n', value: 'v' }])).toEqual([
      { optionId: 'a', name: 'n', value: 'v', price: 0 },
    ]);
  });
});
