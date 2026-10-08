import {
  availableMethodsForCart,
  methodsForProduct,
  pickShippingMethod,
  resolveShippingFee,
} from './ec-shipping';

const nekopos = { id: 'n', name: 'ネコポス', fee: 600, isDefault: false, isActive: true, sortOrder: 0 };
const compact = { id: 'c', name: '宅急便コンパクト', fee: 800, isDefault: false, isActive: true, sortOrder: 1 };
const takkyubin = { id: 't', name: 'ヤマト宅急便', fee: 1000, isDefault: true, isActive: true, sortOrder: 2 };
const disabled = { id: 'x', name: '廃止済み', fee: 100, isDefault: false, isActive: false, sortOrder: 3 };
const ALL = [takkyubin, compact, nekopos, disabled];

describe('methodsForProduct', () => {
  it('割り当てがあればその配送方法だけ (並び順でソート)', () => {
    expect(methodsForProduct(ALL, ['c', 'n']).map((m) => m.id)).toEqual(['n', 'c']);
  });
  it('割り当てが無ければ基本配送 (isDefault) にフォールバック', () => {
    expect(methodsForProduct(ALL, []).map((m) => m.id)).toEqual(['t']);
  });
  it('無効な配送方法は候補に含めない', () => {
    expect(methodsForProduct(ALL, ['x']).map((m) => m.id)).toEqual(['t']); // x は無効 → 基本配送
  });
});

describe('availableMethodsForCart', () => {
  it('カートが空なら []', () => {
    expect(availableMethodsForCart(ALL, [])).toEqual([]);
  });
  it('全商品が対応する配送方法の積集合を返す', () => {
    const lines = [
      { productId: 'p1', shippingMethodIds: ['n', 'c', 't'] },
      { productId: 'p2', shippingMethodIds: ['c', 't'] },
    ];
    expect(availableMethodsForCart(ALL, lines).map((m) => m.id)).toEqual(['c', 't']);
  });
  it('積集合が空なら最低送料が一番高い商品 (大きい荷物) の候補に合わせる', () => {
    const lines = [
      { productId: 'p1', shippingMethodIds: ['n'] }, // チェキ: ネコポスのみ
      { productId: 'p2', shippingMethodIds: ['t'] }, // Tシャツ: 宅急便のみ
    ];
    expect(availableMethodsForCart(ALL, lines).map((m) => m.id)).toEqual(['t']);
  });
  it('同じ商品の別バリエーションは 1 回だけ数える', () => {
    const lines = [
      { productId: 'p1', shippingMethodIds: ['n', 'c'] },
      { productId: 'p1', shippingMethodIds: ['n', 'c'] },
    ];
    expect(availableMethodsForCart(ALL, lines).map((m) => m.id)).toEqual(['n', 'c']);
  });
  it('未割り当て商品は基本配送として扱う', () => {
    const lines = [
      { productId: 'p1', shippingMethodIds: [] },
      { productId: 'p2', shippingMethodIds: ['n', 't'] },
    ];
    expect(availableMethodsForCart(ALL, lines).map((m) => m.id)).toEqual(['t']);
  });
});

describe('pickShippingMethod', () => {
  const cands = [nekopos, compact];
  it('選択があり候補内ならそれを返す', () => {
    expect(pickShippingMethod(cands, 'c')?.id).toBe('c');
  });
  it('未選択なら先頭 (最安)', () => {
    expect(pickShippingMethod(cands, null)?.id).toBe('n');
  });
  it('候補外の id なら先頭にフォールバック', () => {
    expect(pickShippingMethod(cands, 't')?.id).toBe('n');
  });
  it('候補が無ければ null', () => {
    expect(pickShippingMethod([], 'n')).toBeNull();
  });
});

describe('resolveShippingFee', () => {
  it('閾値未満なら配送方法の送料', () => {
    expect(resolveShippingFee(compact, 3000, 8000, 600)).toBe(800);
  });
  it('閾値以上なら 0', () => {
    expect(resolveShippingFee(compact, 8000, 8000, 600)).toBe(0);
  });
  it('閾値 0 は常時無料', () => {
    expect(resolveShippingFee(compact, 100, 0, 600)).toBe(0);
  });
  it('配送方法が無ければ fallback', () => {
    expect(resolveShippingFee(null, 3000, 8000, 600)).toBe(600);
  });
});
