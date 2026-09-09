/**
 * MyRoom (2次元の ReiRieRoom) — 部屋レイアウトの純粋ロジック。
 *
 * 家具マスタ (myroom-furniture.ts) が «どんな家具があるか» を扱うのに対し、
 * ここは «その家具を部屋のどこに、重ならないように置けるか» を扱う。
 *
 * 副作用のない関数のみを置く (DB アクセス・乱数・描画は含めない)。
 * サーバーとクライアントで同じ判定を共有することで、
 * 「画面では置けたのに保存で弾かれる」という食い違いを防ぐ。
 *
 * ===================================================================
 * 【座標系】
 * ===================================================================
 *
 * 床は MYROOM_GRID_SIZE x MYROOM_GRID_SIZE のマス目。
 * 左奥を (0,0) とし、x が右方向、y が手前方向に増える。
 *
 * 表示はアイソメトリック (2:1 の菱形) にする。
 * グリッド座標 → 画面座標の変換は toIsoPoint で行う。
 *
 * 壁掛け家具 (WALL) は床のマス目ではなく «壁面» に置くため、
 * 別の座標系 (wallX, wallY) を使う。床と壁で重なり判定を分ける必要がある。
 *
 * ===================================================================
 * 【重なりのルール — なぜ単純な「全部禁止」にしないか】
 * ===================================================================
 *
 * ラグ (RUG) の上には他の家具を置けないと、部屋作りがほぼ成立しない
 * (ラグを敷くと、その面積ぶん家具が置けなくなる)。
 * 机の上の小物 (DESKTOP) も同様に、机と重ねられないと置き場所がない。
 *
 * そこで «層 (layer)» の概念を持たせ、層が違えば重ねられるようにした。
 *
 *   層 0: RUG        … 床に敷く。何でも上に置ける
 *   層 1: FLOOR/PLANT/OTHER … 床に置く本体。同じ層同士は重ねられない
 *   層 2: DESKTOP    … 家具の上に置く小物。同じ層同士は重ねられない
 *   壁 :  WALL       … 床とは別座標系
 */

import {
  MYROOM_GRID_SIZE,
  type MyRoomFurnitureCategory,
} from './myroom-furniture';

// ---------------------------------------------------------------------
// 描画の定数
// ---------------------------------------------------------------------

/**
 * タイル 1 枚の幅 (px)。高さはこの半分 = 2:1 のアイソメ。
 *
 * 2:1 にしているのは、この比率だと菱形の辺が
 * 「横 2px・縦 1px」の整数比になり、線がギザつかずに描けるため。
 */
export const MYROOM_TILE_W = 104;
export const MYROOM_TILE_H = MYROOM_TILE_W / 2;

/** 壁の高さ (px) */
export const MYROOM_WALL_H = 210;

/** 家具を置ける層 */
export const MYROOM_LAYERS = ['RUG', 'FLOOR', 'DESKTOP', 'WALL'] as const;
export type MyRoomLayer = (typeof MYROOM_LAYERS)[number];

/**
 * カテゴリ → 層。
 *
 * PLANT / OTHER を FLOOR と同じ層にしているのは、どちらも
 * «床に置く実体のあるもの» で、他の床家具と場所を取り合う関係にあるため。
 */
const CATEGORY_LAYER: Record<MyRoomFurnitureCategory, MyRoomLayer> = {
  RUG: 'RUG',
  FLOOR: 'FLOOR',
  PLANT: 'FLOOR',
  OTHER: 'FLOOR',
  DESKTOP: 'DESKTOP',
  WALL: 'WALL',
};

/** そのカテゴリの家具が属する層 */
export function layerOfCategory(category: MyRoomFurnitureCategory): MyRoomLayer {
  return CATEGORY_LAYER[category];
}

/** 壁に掛ける家具か (床の座標系を使わない) */
export function isWallCategory(category: MyRoomFurnitureCategory): boolean {
  return layerOfCategory(category) === 'WALL';
}

// ---------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------

/** 部屋に置かれた家具 1 つ */
export type PlacedFurniture = {
  /** 配置の識別子 (同じ家具を複数置けるので家具 ID とは別) */
  id: string;
  /** 家具マスタの ID */
  furnitureId: string;
  category: MyRoomFurnitureCategory;
  /** 左上のマス (床) / 壁面上の位置 (壁掛け) */
  x: number;
  y: number;
  /** 占有マス数 */
  widthCells: number;
  heightCells: number;
};

/** 矩形 (判定用) */
export type CellRect = {
  x: number;
  y: number;
  widthCells: number;
  heightCells: number;
};

/** 配置できない理由 */
export type PlacementError =
  /** 部屋の外に出る */
  | 'OUT_OF_BOUNDS'
  /** 同じ層の家具と重なる */
  | 'OVERLAP'
  /** サイズが不正 (0 以下など) */
  | 'INVALID_SIZE';

export type PlacementResult =
  | { ok: true }
  | { ok: false; reason: PlacementError; conflictId?: string };

// ---------------------------------------------------------------------
// 座標変換
// ---------------------------------------------------------------------

/**
 * グリッド座標 → アイソメトリックの画面座標。
 *
 * 菱形タイルの «上頂点» を返す。
 * 原点 (0,0) が画面の最上部中央に来るよう、呼び出し側で平行移動する。
 */
export function toIsoPoint(
  x: number,
  y: number,
  tileW: number = MYROOM_TILE_W,
  tileH: number = MYROOM_TILE_H,
): { sx: number; sy: number } {
  return {
    sx: (x - y) * (tileW / 2),
    sy: (x + y) * (tileH / 2),
  };
}

/**
 * 描画順 (奥から手前へ) を決めるためのキー。
 *
 * アイソメトリックでは «奥のものを先に描く» 必要がある。
 * 奥行きは x + y で決まり、同じ奥行きなら層が下のものを先に描く。
 *
 * これを間違えると、手前の家具が奥の家具に隠れるという
 * 目で見て明らかにおかしい絵になる。
 */
export function isoDepthKey(item: PlacedFurniture): number {
  const layerIndex = MYROOM_LAYERS.indexOf(layerOfCategory(item.category));
  // 奥行きを主キー、層を副キーにする (層は 0〜3 なので 100 倍で十分に分離できる)
  return (item.x + item.y) * 100 + layerIndex;
}

/** 描画順に並べ替える (元の配列は変更しない) */
export function sortForRender(items: PlacedFurniture[]): PlacedFurniture[] {
  return [...items].sort((a, b) => isoDepthKey(a) - isoDepthKey(b));
}

// ---------------------------------------------------------------------
// 配置の判定
// ---------------------------------------------------------------------

/** 2 つの矩形が重なるか */
export function rectsOverlap(a: CellRect, b: CellRect): boolean {
  return (
    a.x < b.x + b.widthCells &&
    b.x < a.x + a.widthCells &&
    a.y < b.y + b.heightCells &&
    b.y < a.y + a.heightCells
  );
}

/** 矩形が部屋 (グリッド) に収まるか */
export function isWithinRoom(
  rect: CellRect,
  gridSize: number = MYROOM_GRID_SIZE,
): boolean {
  if (!Number.isInteger(rect.x) || !Number.isInteger(rect.y)) return false;
  if (rect.x < 0 || rect.y < 0) return false;
  return (
    rect.x + rect.widthCells <= gridSize && rect.y + rect.heightCells <= gridSize
  );
}

/**
 * その位置に家具を置けるか判定する。
 *
 * @param candidate 置こうとしている家具
 * @param placed    すでに置かれている家具
 * @param gridSize  部屋の一辺のマス数
 *
 * 【同じ配置 ID は無視する】
 * 家具を «移動» するときは、自分自身と重なっていても構わない。
 * ここで自分を除外しないと、1 マスも動かせなくなる。
 */
export function canPlaceFurniture(
  candidate: PlacedFurniture,
  placed: PlacedFurniture[],
  gridSize: number = MYROOM_GRID_SIZE,
): PlacementResult {
  if (
    !Number.isInteger(candidate.widthCells) ||
    !Number.isInteger(candidate.heightCells) ||
    candidate.widthCells <= 0 ||
    candidate.heightCells <= 0
  ) {
    return { ok: false, reason: 'INVALID_SIZE' };
  }

  if (!isWithinRoom(candidate, gridSize)) {
    return { ok: false, reason: 'OUT_OF_BOUNDS' };
  }

  const layer = layerOfCategory(candidate.category);

  for (const other of placed) {
    // 移動中の自分自身は無視する
    if (other.id === candidate.id) continue;
    // 層が違えば重ねられる (ラグの上に机、机の上に小物)
    if (layerOfCategory(other.category) !== layer) continue;
    if (rectsOverlap(candidate, other)) {
      return { ok: false, reason: 'OVERLAP', conflictId: other.id };
    }
  }

  return { ok: true };
}

/** 配置できない理由の日本語メッセージ (UI 表示用) */
export const PLACEMENT_ERROR_MESSAGES: Record<PlacementError, string> = {
  OUT_OF_BOUNDS: '部屋の外には置けません',
  OVERLAP: 'ほかの家具と重なっています',
  INVALID_SIZE: '家具のサイズが正しくありません',
};

/**
 * 部屋全体のレイアウトが妥当か検証する。
 *
 * 保存されたデータを読むときに使う。1 つずつ canPlaceFurniture で
 * 積み上げていくことで、«保存時には妥当だったが家具マスタの
 * サイズ変更で重なってしまった» ような破損も検出できる。
 */
export function validateRoomLayout(
  items: PlacedFurniture[],
  gridSize: number = MYROOM_GRID_SIZE,
): { ok: true } | { ok: false; invalid: { id: string; reason: PlacementError }[] } {
  const accepted: PlacedFurniture[] = [];
  const invalid: { id: string; reason: PlacementError }[] = [];

  for (const item of items) {
    const res = canPlaceFurniture(item, accepted, gridSize);
    if (res.ok) accepted.push(item);
    else invalid.push({ id: item.id, reason: res.reason });
  }

  return invalid.length === 0 ? { ok: true } : { ok: false, invalid };
}

/**
 * 家具を置ける «空き» を探す。
 *
 * 部屋を左奥から順に走査して、最初に置ける位置を返す。
 * 見つからなければ null。
 *
 * 「置く」ボタンを押したときに、利用者が座標を指定しなくても
 * とりあえず置けるようにするために使う
 * (座標を選ばせるだけの UI だと、空きを探す作業を利用者に押し付けることになる)。
 */
export function findFreeSpot(
  candidate: Omit<PlacedFurniture, 'x' | 'y'>,
  placed: PlacedFurniture[],
  gridSize: number = MYROOM_GRID_SIZE,
): { x: number; y: number } | null {
  for (let y = 0; y <= gridSize - candidate.heightCells; y++) {
    for (let x = 0; x <= gridSize - candidate.widthCells; x++) {
      const res = canPlaceFurniture({ ...candidate, x, y }, placed, gridSize);
      if (res.ok) return { x, y };
    }
  }
  return null;
}

/** 部屋に置かれた家具の合計 Pui (返金額の計算などに使う) */
export function totalPlacedCost(
  items: { puiCost: number }[],
): number {
  return items.reduce((sum, i) => sum + Math.max(0, i.puiCost), 0);
}
