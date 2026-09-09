import {
  MYROOM_LAYERS,
  MYROOM_TILE_H,
  MYROOM_TILE_W,
  PLACEMENT_ERROR_MESSAGES,
  canPlaceFurniture,
  findFreeSpot,
  isWallCategory,
  isWithinRoom,
  isoDepthKey,
  layerOfCategory,
  rectsOverlap,
  sortForRender,
  toIsoPoint,
  totalPlacedCost,
  validateRoomLayout,
  type PlacedFurniture,
} from './myroom-layout';
import {
  MYROOM_FURNITURE_CATEGORIES,
  MYROOM_GRID_SIZE,
  type MyRoomFurnitureCategory,
} from './myroom-furniture';

function item(
  over: Partial<PlacedFurniture> & { id: string },
): PlacedFurniture {
  return {
    furnitureId: 'f1',
    category: 'FLOOR',
    x: 0,
    y: 0,
    widthCells: 1,
    heightCells: 1,
    ...over,
  };
}

describe('定数と層の対応', () => {
  it('タイルは 2:1 のアイソメ比になっている', () => {
    // 2:1 でないと菱形の辺がギザつく
    expect(MYROOM_TILE_W).toBe(MYROOM_TILE_H * 2);
  });

  /**
   * カテゴリを追加したときに層の割り当てを忘れると、
   * layerOfCategory が undefined を返して重なり判定が
   * 「常に層が違う = 何でも重ねられる」に崩れる。
   */
  it('すべてのカテゴリに層が割り当てられている', () => {
    for (const c of MYROOM_FURNITURE_CATEGORIES) {
      const layer = layerOfCategory(c);
      expect(MYROOM_LAYERS).toContain(layer);
    }
  });

  it('壁掛けだけが WALL 層になる', () => {
    expect(isWallCategory('WALL')).toBe(true);
    for (const c of MYROOM_FURNITURE_CATEGORIES.filter((x) => x !== 'WALL')) {
      expect(isWallCategory(c)).toBe(false);
    }
  });

  it('ラグ・床家具・小物はそれぞれ別の層になる', () => {
    expect(layerOfCategory('RUG')).toBe('RUG');
    expect(layerOfCategory('FLOOR')).toBe('FLOOR');
    expect(layerOfCategory('DESKTOP')).toBe('DESKTOP');
  });

  it('植物・その他は床家具と同じ層 (場所を取り合う)', () => {
    expect(layerOfCategory('PLANT')).toBe('FLOOR');
    expect(layerOfCategory('OTHER')).toBe('FLOOR');
  });
});

describe('toIsoPoint', () => {
  it('原点は画面原点に写る', () => {
    expect(toIsoPoint(0, 0)).toEqual({ sx: 0, sy: 0 });
  });

  it('x が増えると右下へ、y が増えると左下へ動く', () => {
    const px = toIsoPoint(1, 0);
    const py = toIsoPoint(0, 1);
    expect(px.sx).toBeGreaterThan(0);
    expect(py.sx).toBeLessThan(0);
    // どちらも下方向 (奥行きが手前に来る)
    expect(px.sy).toBeGreaterThan(0);
    expect(py.sy).toBeGreaterThan(0);
  });

  it('対角に進むと横位置が戻り、縦だけ進む', () => {
    expect(toIsoPoint(2, 2)).toEqual({ sx: 0, sy: 2 * MYROOM_TILE_H });
  });
});

describe('描画順', () => {
  /**
   * アイソメトリックは奥から描かないと、手前の家具が
   * 奥の家具に隠れるという明らかにおかしい絵になる。
   */
  it('奥 (x+y が小さい) ほど先に描かれる', () => {
    const near = item({ id: 'near', x: 5, y: 5 });
    const far = item({ id: 'far', x: 0, y: 0 });
    expect(isoDepthKey(far)).toBeLessThan(isoDepthKey(near));
  });

  it('同じ奥行きならラグ→床→小物の順に描かれる', () => {
    const rug = item({ id: 'rug', category: 'RUG', x: 2, y: 2 });
    const floor = item({ id: 'floor', category: 'FLOOR', x: 2, y: 2 });
    const desk = item({ id: 'desk', category: 'DESKTOP', x: 2, y: 2 });
    const order = sortForRender([desk, floor, rug]).map((i) => i.id);
    expect(order).toEqual(['rug', 'floor', 'desk']);
  });

  it('sortForRender は元の配列を変更しない', () => {
    const list = [item({ id: 'b', x: 3, y: 3 }), item({ id: 'a', x: 0, y: 0 })];
    const before = list.map((i) => i.id);
    sortForRender(list);
    expect(list.map((i) => i.id)).toEqual(before);
  });
});

describe('rectsOverlap', () => {
  it('重なっていれば true', () => {
    expect(
      rectsOverlap(
        { x: 0, y: 0, widthCells: 2, heightCells: 2 },
        { x: 1, y: 1, widthCells: 2, heightCells: 2 },
      ),
    ).toBe(true);
  });

  /** 辺が接するだけなら重なっていない (隣に並べて置ける) */
  it('辺が接するだけなら false', () => {
    expect(
      rectsOverlap(
        { x: 0, y: 0, widthCells: 2, heightCells: 2 },
        { x: 2, y: 0, widthCells: 2, heightCells: 2 },
      ),
    ).toBe(false);
  });

  it('離れていれば false', () => {
    expect(
      rectsOverlap(
        { x: 0, y: 0, widthCells: 1, heightCells: 1 },
        { x: 5, y: 5, widthCells: 1, heightCells: 1 },
      ),
    ).toBe(false);
  });
});

describe('isWithinRoom', () => {
  it('ぴったり収まる位置は OK', () => {
    expect(
      isWithinRoom({
        x: MYROOM_GRID_SIZE - 2,
        y: MYROOM_GRID_SIZE - 2,
        widthCells: 2,
        heightCells: 2,
      }),
    ).toBe(true);
  });

  it('1 マスでもはみ出せば NG', () => {
    expect(
      isWithinRoom({
        x: MYROOM_GRID_SIZE - 1,
        y: 0,
        widthCells: 2,
        heightCells: 1,
      }),
    ).toBe(false);
  });

  it('負の座標は NG', () => {
    expect(isWithinRoom({ x: -1, y: 0, widthCells: 1, heightCells: 1 })).toBe(false);
  });

  it('整数でない座標は NG', () => {
    expect(isWithinRoom({ x: 1.5, y: 0, widthCells: 1, heightCells: 1 })).toBe(false);
  });
});

describe('canPlaceFurniture', () => {
  it('空の部屋には置ける', () => {
    expect(canPlaceFurniture(item({ id: 'a' }), []).ok).toBe(true);
  });

  it('部屋の外にはみ出す配置は OUT_OF_BOUNDS', () => {
    const res = canPlaceFurniture(
      item({ id: 'a', x: MYROOM_GRID_SIZE - 1, widthCells: 3 }),
      [],
    );
    expect(res).toMatchObject({ ok: false, reason: 'OUT_OF_BOUNDS' });
  });

  it('同じ層の家具と重なると OVERLAP (相手の ID も返す)', () => {
    const existing = item({ id: 'bed', x: 0, y: 0, widthCells: 2, heightCells: 4 });
    const res = canPlaceFurniture(item({ id: 'sofa', x: 1, y: 1 }), [existing]);
    expect(res).toMatchObject({ ok: false, reason: 'OVERLAP', conflictId: 'bed' });
  });

  /**
   * ここが「単純に全部禁止」にしなかった理由の中心。
   * ラグの上に家具を置けないと部屋作りが成立しない。
   */
  it('ラグの上には床家具を置ける (層が違う)', () => {
    const rug = item({
      id: 'rug',
      category: 'RUG',
      x: 0,
      y: 0,
      widthCells: 4,
      heightCells: 4,
    });
    const res = canPlaceFurniture(
      item({ id: 'table', category: 'FLOOR', x: 1, y: 1, widthCells: 2, heightCells: 2 }),
      [rug],
    );
    expect(res.ok).toBe(true);
  });

  it('机の上に小物を置ける (層が違う)', () => {
    const desk = item({
      id: 'desk',
      category: 'FLOOR',
      x: 2,
      y: 2,
      widthCells: 3,
      heightCells: 2,
    });
    const res = canPlaceFurniture(
      item({ id: 'lamp', category: 'DESKTOP', x: 3, y: 2 }),
      [desk],
    );
    expect(res.ok).toBe(true);
  });

  it('ラグ同士は重ねられない', () => {
    const rug = item({ id: 'r1', category: 'RUG', x: 0, y: 0, widthCells: 3, heightCells: 3 });
    const res = canPlaceFurniture(
      item({ id: 'r2', category: 'RUG', x: 1, y: 1 }),
      [rug],
    );
    expect(res).toMatchObject({ ok: false, reason: 'OVERLAP' });
  });

  it('小物同士は重ねられない', () => {
    const a = item({ id: 'lamp', category: 'DESKTOP', x: 3, y: 3 });
    const res = canPlaceFurniture(
      item({ id: 'photo', category: 'DESKTOP', x: 3, y: 3 }),
      [a],
    );
    expect(res).toMatchObject({ ok: false, reason: 'OVERLAP' });
  });

  /**
   * 移動時に自分自身と衝突すると、1 マスも動かせなくなる。
   */
  it('同じ配置 ID (移動中の自分) は衝突扱いにしない', () => {
    const self = item({ id: 'same', x: 3, y: 3, widthCells: 2, heightCells: 2 });
    const moved = item({ id: 'same', x: 4, y: 3, widthCells: 2, heightCells: 2 });
    expect(canPlaceFurniture(moved, [self]).ok).toBe(true);
  });

  it('サイズが 0 以下なら INVALID_SIZE', () => {
    expect(canPlaceFurniture(item({ id: 'a', widthCells: 0 }), [])).toMatchObject({
      ok: false,
      reason: 'INVALID_SIZE',
    });
    expect(canPlaceFurniture(item({ id: 'a', heightCells: -1 }), [])).toMatchObject({
      ok: false,
      reason: 'INVALID_SIZE',
    });
  });

  it('壁掛けは床家具と衝突しない (座標系が別)', () => {
    const floor = item({ id: 'bed', category: 'FLOOR', x: 0, y: 0, widthCells: 3, heightCells: 3 });
    const res = canPlaceFurniture(
      item({ id: 'poster', category: 'WALL', x: 0, y: 0, widthCells: 2 }),
      [floor],
    );
    expect(res.ok).toBe(true);
  });

  it('壁掛け同士は重ねられない', () => {
    const a = item({ id: 'p1', category: 'WALL', x: 0, y: 0, widthCells: 2 });
    const res = canPlaceFurniture(
      item({ id: 'p2', category: 'WALL', x: 1, y: 0, widthCells: 2 }),
      [a],
    );
    expect(res).toMatchObject({ ok: false, reason: 'OVERLAP' });
  });
});

describe('validateRoomLayout', () => {
  it('妥当なレイアウトは ok', () => {
    const items = [
      item({ id: 'a', x: 0, y: 0, widthCells: 2, heightCells: 2 }),
      item({ id: 'b', x: 4, y: 4, widthCells: 2, heightCells: 2 }),
    ];
    expect(validateRoomLayout(items)).toEqual({ ok: true });
  });

  /**
   * 保存時は妥当でも、家具マスタのサイズが後から変更されると
   * 重なりが発生しうる。読み込み時に検出できることを固定する。
   */
  it('重なっているレイアウトは該当 ID と理由を返す', () => {
    const items = [
      item({ id: 'a', x: 0, y: 0, widthCells: 3, heightCells: 3 }),
      item({ id: 'b', x: 1, y: 1, widthCells: 2, heightCells: 2 }),
    ];
    const res = validateRoomLayout(items);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.invalid).toEqual([{ id: 'b', reason: 'OVERLAP' }]);
  });

  it('はみ出しているレイアウトも検出する', () => {
    const res = validateRoomLayout([
      item({ id: 'a', x: MYROOM_GRID_SIZE - 1, widthCells: 5 }),
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.invalid[0]).toEqual({ id: 'a', reason: 'OUT_OF_BOUNDS' });
  });

  it('空の部屋は ok', () => {
    expect(validateRoomLayout([])).toEqual({ ok: true });
  });
});

describe('findFreeSpot', () => {
  it('空の部屋では左奥 (0,0) を返す', () => {
    expect(
      findFreeSpot(
        { id: 'a', furnitureId: 'f', category: 'FLOOR', widthCells: 2, heightCells: 2 },
        [],
      ),
    ).toEqual({ x: 0, y: 0 });
  });

  it('埋まっている場所を避けて空きを返す', () => {
    const blocker = item({ id: 'b', x: 0, y: 0, widthCells: 2, heightCells: 2 });
    const spot = findFreeSpot(
      { id: 'a', furnitureId: 'f', category: 'FLOOR', widthCells: 2, heightCells: 2 },
      [blocker],
    );
    expect(spot).not.toBeNull();
    // 返ってきた位置に実際に置けること
    expect(
      canPlaceFurniture(item({ id: 'a', ...spot!, widthCells: 2, heightCells: 2 }), [
        blocker,
      ]).ok,
    ).toBe(true);
  });

  it('部屋いっぱいの家具が既にあるなら null', () => {
    const full = item({
      id: 'full',
      x: 0,
      y: 0,
      widthCells: MYROOM_GRID_SIZE,
      heightCells: MYROOM_GRID_SIZE,
    });
    expect(
      findFreeSpot(
        { id: 'a', furnitureId: 'f', category: 'FLOOR', widthCells: 1, heightCells: 1 },
        [full],
      ),
    ).toBeNull();
  });

  it('部屋より大きい家具は置けず null', () => {
    expect(
      findFreeSpot(
        {
          id: 'a',
          furnitureId: 'f',
          category: 'FLOOR',
          widthCells: MYROOM_GRID_SIZE + 1,
          heightCells: 1,
        },
        [],
      ),
    ).toBeNull();
  });

  it('層が違えば埋まった場所にも置ける (ラグの上)', () => {
    const rug = item({
      id: 'rug',
      category: 'RUG',
      x: 0,
      y: 0,
      widthCells: MYROOM_GRID_SIZE,
      heightCells: MYROOM_GRID_SIZE,
    });
    expect(
      findFreeSpot(
        { id: 'a', furnitureId: 'f', category: 'FLOOR', widthCells: 1, heightCells: 1 },
        [rug],
      ),
    ).toEqual({ x: 0, y: 0 });
  });
});

describe('totalPlacedCost', () => {
  it('合計を返す', () => {
    expect(totalPlacedCost([{ puiCost: 100 }, { puiCost: 250 }])).toBe(350);
  });

  it('空なら 0', () => {
    expect(totalPlacedCost([])).toBe(0);
  });

  it('負の値は 0 として扱う (データ破損で返金額が減らないように)', () => {
    expect(totalPlacedCost([{ puiCost: -500 }, { puiCost: 100 }])).toBe(100);
  });
});

describe('エラーメッセージ', () => {
  it('すべての理由に日本語メッセージがある', () => {
    const reasons: Array<keyof typeof PLACEMENT_ERROR_MESSAGES> = [
      'OUT_OF_BOUNDS',
      'OVERLAP',
      'INVALID_SIZE',
    ];
    for (const r of reasons) {
      expect(PLACEMENT_ERROR_MESSAGES[r]).toBeTruthy();
    }
  });
});
