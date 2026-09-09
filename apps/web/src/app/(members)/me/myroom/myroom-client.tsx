'use client';

/**
 * ReiRieRoom (MyRoom) — アイソメトリック描画のクライアント UI。
 *
 * 【現段階の位置づけ】
 * 「非公開・管理者のみ」で運用する前提のプレビュー画面。
 * 配置はブラウザ内 (localStorage) にのみ保持し、まだサーバーへ保存しない。
 *
 * サーバー保存を入れていないのは、保存すると Pui の消費・返金という
 * お金に関わる処理が必要になり、未完成のまま会員の残高を動かすと
 * 返金対応が発生するため。まず «見た目と操作» を運営に確認してもらう。
 *
 * 【重なり判定は共有ロジックを使う】
 * canPlaceFurniture / findFreeSpot は @idol/shared に置いてある。
 * ここで独自に判定すると、サーバー保存を入れたときに
 * 「画面では置けたのに保存で弾かれる」食い違いが生まれる。
 *
 * 【描画方法】
 * 家具画像は API 経由の URL を <img> で読み込む。
 * Canvas ではなく DOM を使うのは、家具ごとにクリック領域と
 * アクセシビリティ (ボタンとしての操作) を持たせやすいため。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MYROOM_FURNITURE_CATEGORIES,
  MYROOM_FURNITURE_CATEGORY_LABELS,
  MYROOM_TILE_H,
  MYROOM_TILE_W,
  PLACEMENT_ERROR_MESSAGES,
  canPlaceFurniture,
  findFreeSpot,
  isWallCategory,
  sortForRender,
  toIsoPoint,
  type MyRoomFurnitureCategory,
  type PlacedFurniture,
} from '@idol/shared';
import { Button } from '@/components/ui/Button';

type CatalogItem = {
  id: string;
  name: string;
  description: string | null;
  category: MyRoomFurnitureCategory;
  puiCost: number;
  widthCells: number;
  heightCells: number;
  imageUrl: string;
};

type Props = {
  gridSize: number;
  balance: number;
  catalog: CatalogItem[];
};

/** localStorage のキー。まだサーバー保存しないため端末内にだけ残る。 */
const STORAGE_KEY = 'idol.myroom.preview.v1';

/** 表示倍率 (スマホでも 12x12 が収まるように縮める) */
const SCALE = 0.42;
const TILE_W = MYROOM_TILE_W * SCALE;
const TILE_H = MYROOM_TILE_H * SCALE;

export function MyRoomClient({ gridSize, balance, catalog }: Props) {
  const [placed, setPlaced] = useState<PlacedFurniture[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [category, setCategory] = useState<MyRoomFurnitureCategory | 'ALL'>('ALL');
  const [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  /** 家具マスタを id で引けるようにする */
  const byId = useMemo(() => {
    const m = new Map<string, CatalogItem>();
    for (const c of catalog) m.set(c.id, c);
    return m;
  }, [catalog]);

  // 端末内に保存した配置を復元する
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // 家具マスタから消えた家具は捨てる
          // (運営が家具を削除した後も残り続けると、画像が出ない枠になる)
          setPlaced(
            (parsed as PlacedFurniture[]).filter((p) => byId.has(p.furnitureId)),
          );
        }
      }
    } catch {
      // 壊れていたら無かったことにする (プレビューなので復旧は不要)
    }
    setLoaded(true);
  }, [byId]);

  // 配置が変わったら保存する
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(placed));
    } catch {
      // 保存できなくても操作は続行できる (容量超過など)
    }
  }, [placed, loaded]);

  const filtered = useMemo(
    () => (category === 'ALL' ? catalog : catalog.filter((c) => c.category === category)),
    [catalog, category],
  );

  /** カタログから家具を追加する (空きを自動で探す) */
  const add = useCallback(
    (c: CatalogItem) => {
      setMessage(null);
      const draft = {
        id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        furnitureId: c.id,
        category: c.category,
        widthCells: c.widthCells,
        heightCells: c.heightCells,
      };
      const spot = findFreeSpot(draft, placed, gridSize);
      if (!spot) {
        setMessage(`「${c.name}」を置く場所がありません。ほかの家具を動かしてください。`);
        return;
      }
      setPlaced((prev) => [...prev, { ...draft, ...spot }]);
      setSelectedId(draft.id);
    },
    [gridSize, placed],
  );

  /** 選択中の家具を動かす */
  const move = useCallback(
    (dx: number, dy: number) => {
      if (!selectedId) return;
      setMessage(null);
      setPlaced((prev) => {
        const target = prev.find((p) => p.id === selectedId);
        if (!target) return prev;
        const moved = { ...target, x: target.x + dx, y: target.y + dy };
        const res = canPlaceFurniture(moved, prev, gridSize);
        if (!res.ok) {
          setMessage(PLACEMENT_ERROR_MESSAGES[res.reason]);
          return prev;
        }
        return prev.map((p) => (p.id === selectedId ? moved : p));
      });
    },
    [gridSize, selectedId],
  );

  const remove = useCallback(() => {
    if (!selectedId) return;
    setPlaced((prev) => prev.filter((p) => p.id !== selectedId));
    setSelectedId(null);
    setMessage(null);
  }, [selectedId]);

  const clearAll = useCallback(() => {
    setPlaced([]);
    setSelectedId(null);
    setMessage(null);
  }, []);

  // 部屋の描画サイズ。菱形なので幅は gridSize*TILE_W、高さは gridSize*TILE_H。
  const boardW = gridSize * TILE_W;
  const boardH = gridSize * TILE_H;
  // 原点 (0,0) を上端中央に置くためのオフセット
  const originX = boardW / 2;

  const floorItems = sortForRender(placed.filter((p) => !isWallCategory(p.category)));
  const wallItems = placed.filter((p) => isWallCategory(p.category));

  const selected = placed.find((p) => p.id === selectedId) ?? null;
  const selectedMaster = selected ? byId.get(selected.furnitureId) : null;

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-xl font-bold text-slate-900">🏠 ReiRieRoom</h1>
        <p className="mt-1 text-sm text-slate-500">
          好きな家具をならべて、自分だけの部屋をつくれます。
        </p>
      </header>

      <dl className="mb-4 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-3 text-center">
        <div>
          <dt className="text-[11px] text-slate-500">おいている家具</dt>
          <dd className="text-base font-bold text-slate-900">{placed.length} 個</dd>
        </div>
        <div>
          <dt className="text-[11px] text-slate-500">Pui 残高</dt>
          <dd className="text-base font-bold text-pink-600">
            {balance.toLocaleString()}
          </dd>
        </div>
      </dl>

      {message && (
        <p
          role="alert"
          className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          {message}
        </p>
      )}

      {/* ============ 部屋 ============ */}
      <div className="mb-4 overflow-x-auto rounded-lg border border-slate-200 bg-gradient-to-b from-indigo-50 to-pink-50 p-4">
        <div
          className="relative mx-auto"
          style={{ width: boardW, height: boardH + 120 }}
        >
          {/* 壁 (奥の2面)。床より先に描いて背面にする */}
          <div
            className="absolute rounded-t-sm bg-pink-100/70"
            style={{
              left: 0,
              top: 60,
              width: originX,
              height: 60,
              clipPath: 'polygon(0 0, 100% 50%, 100% 100%, 0 50%)',
            }}
            aria-hidden
          />
          <div
            className="absolute rounded-t-sm bg-purple-100/70"
            style={{
              left: originX,
              top: 60,
              width: originX,
              height: 60,
              clipPath: 'polygon(0 50%, 100% 0, 100% 50%, 0 100%)',
            }}
            aria-hidden
          />

          {/* 床のタイル */}
          <div className="absolute inset-0" style={{ top: 60 }} aria-hidden>
            {Array.from({ length: gridSize }).map((_, y) =>
              Array.from({ length: gridSize }).map((_, x) => {
                const { sx, sy } = toIsoPoint(x, y, TILE_W, TILE_H);
                return (
                  <div
                    key={`${x}-${y}`}
                    className={
                      (x + y) % 2 === 0 ? 'absolute bg-amber-100' : 'absolute bg-amber-50'
                    }
                    style={{
                      left: originX + sx - TILE_W / 2,
                      top: sy,
                      width: TILE_W,
                      height: TILE_H,
                      clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
                    }}
                  />
                );
              }),
            )}
          </div>

          {/* 壁掛け家具 */}
          {wallItems.map((p) => {
            const m = byId.get(p.furnitureId);
            if (!m) return null;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                aria-label={`${m.name}（壁掛け）`}
                className={[
                  'absolute rounded transition',
                  selectedId === p.id ? 'ring-2 ring-pink-500' : '',
                ].join(' ')}
                style={{
                  left: originX + p.x * (TILE_W / 2) - TILE_W / 2,
                  top: 6 + p.y * 24,
                  width: p.widthCells * (TILE_W / 2),
                  height: 48,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.imageUrl}
                  alt={m.name}
                  draggable={false}
                  onContextMenu={(e) => e.preventDefault()}
                  className="h-full w-full select-none object-contain"
                />
              </button>
            );
          })}

          {/* 床の家具 (奥から手前へ) */}
          {floorItems.map((p) => {
            const m = byId.get(p.furnitureId);
            if (!m) return null;
            // 家具の «足元» は占有範囲の左上マスの上頂点に合わせる
            const { sx, sy } = toIsoPoint(p.x, p.y, TILE_W, TILE_H);
            const w = (p.widthCells + p.heightCells) * (TILE_W / 2);
            const h = w * 0.9;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                aria-label={`${m.name}（${p.x + 1}, ${p.y + 1}）`}
                className={[
                  'absolute transition',
                  selectedId === p.id ? 'z-10 ring-2 ring-pink-500' : '',
                ].join(' ')}
                style={{
                  left: originX + sx - w / 2,
                  // 60 は壁のぶんのオフセット。家具は下端を床に合わせる
                  top: 60 + sy - h + (p.heightCells * TILE_H) / 2 + TILE_H,
                  width: w,
                  height: h,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.imageUrl}
                  alt={m.name}
                  draggable={false}
                  onContextMenu={(e) => e.preventDefault()}
                  className="h-full w-full select-none object-contain"
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* ============ 選択中の家具の操作 ============ */}
      {selected && selectedMaster ? (
        <div className="mb-4 rounded-lg border border-pink-200 bg-pink-50 p-3">
          <p className="mb-2 text-sm font-bold text-pink-800">
            選択中: {selectedMaster.name}
            <span className="ml-2 text-xs font-normal text-pink-600">
              {MYROOM_FURNITURE_CATEGORY_LABELS[selected.category]}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="grid grid-cols-3 gap-1">
              <span />
              <button
                type="button"
                onClick={() => move(0, -1)}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50"
                aria-label="奥へ動かす"
              >
                ↑
              </button>
              <span />
              <button
                type="button"
                onClick={() => move(-1, 0)}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50"
                aria-label="左へ動かす"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => move(0, 1)}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50"
                aria-label="手前へ動かす"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => move(1, 0)}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50"
                aria-label="右へ動かす"
              >
                →
              </button>
            </div>
            <button
              type="button"
              onClick={remove}
              className="rounded border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
            >
              かたづける
            </button>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="text-xs text-slate-500 underline hover:text-slate-700"
            >
              選択をやめる
            </button>
          </div>
        </div>
      ) : (
        <p className="mb-4 text-xs text-slate-500">
          部屋の家具をタップすると、動かしたり片づけたりできます。
        </p>
      )}

      {/* ============ 家具カタログ ============ */}
      <section>
        <h2 className="mb-2 text-sm font-bold text-slate-800">家具をえらぶ</h2>

        {catalog.length === 0 ? (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
            まだ家具が登録されていません。
            <br />
            <span className="text-xs text-slate-500">
              管理画面の「MyRoom → 家具マスタ」から、画像付きで「販売中」の家具を追加すると
              ここに並びます。
            </span>
          </p>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setCategory('ALL')}
                className={[
                  'rounded-full px-3 py-1 text-xs',
                  category === 'ALL'
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
                ].join(' ')}
              >
                すべて
              </button>
              {MYROOM_FURNITURE_CATEGORIES.filter((c) =>
                catalog.some((f) => f.category === c),
              ).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={[
                    'rounded-full px-3 py-1 text-xs',
                    category === c
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
                  ].join(' ')}
                >
                  {MYROOM_FURNITURE_CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>

            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => add(c)}
                    className="w-full rounded-lg border border-slate-200 bg-white p-2 text-left transition hover:border-pink-300 hover:bg-pink-50"
                  >
                    <span className="flex h-16 items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={c.imageUrl}
                        alt=""
                        draggable={false}
                        onContextMenu={(e) => e.preventDefault()}
                        className="max-h-16 max-w-full select-none object-contain"
                      />
                    </span>
                    <span className="mt-1 block truncate text-xs font-semibold text-slate-800">
                      {c.name}
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      {c.widthCells}×{c.heightCells}マス
                      {c.puiCost > 0 && ` / ${c.puiCost.toLocaleString()} Pui`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {placed.length > 0 && (
        <div className="mt-4 text-right">
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-slate-400 underline hover:text-slate-600"
          >
            ぜんぶかたづける
          </button>
        </div>
      )}

      {/*
        現段階の制限を明示する。
        「保存したつもりが消えていた」という誤解を防ぐため、
        端末内にしか残らないことをはっきり書いておく。
      */}
      <p className="mt-6 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
        ※ 現在は準備中のため、配置はこの端末のブラウザにのみ保存されます
        （ほかの端末には引き継がれません）。家具の購入・Pui の消費はまだ行われません。
      </p>
    </div>
  );
}
