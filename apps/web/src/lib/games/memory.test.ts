/**
 * 神経衰弱のサーバー側盤面生成テスト。
 *
 * DB アクセスを含む collectMemoryPhotoPool は結合テストの領域なので、
 * ここでは «盤面の組み立て» の正しさを固定する。
 * 盤面が壊れるとプレイヤーには «揃わないバグ» としか見えず、
 * Pui の補填対応が発生するため、生成の不変条件は厳しく確認する。
 */
import { buildMemoryBoard } from './memory';
import {
  MEMORY_PAIR_COUNT,
  isValidMemoryBoard,
  type MemoryPhoto,
} from '@idol/shared';

function makePool(n: number): MemoryPhoto[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `img_${i}`,
    url: `/api/media/content-body-image/img_${i}`,
    caption: `写真${i}`,
  }));
}

describe('buildMemoryBoard', () => {
  it('十分な写真があれば有効な盤面を生成する', () => {
    const res = buildMemoryBoard(makePool(20));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(isValidMemoryBoard(res.board)).toBe(true);
    expect(res.board.photos).toHaveLength(MEMORY_PAIR_COUNT);
    expect(res.board.cards).toHaveLength(MEMORY_PAIR_COUNT * 2);
  });

  it('各ペアがちょうど 2 枚ずつ配置される', () => {
    const res = buildMemoryBoard(makePool(20));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const counts = new Map<number, number>();
    for (const p of res.board.cards) counts.set(p, (counts.get(p) ?? 0) + 1);
    expect([...counts.values()].every((c) => c === 2)).toBe(true);
    expect(counts.size).toBe(MEMORY_PAIR_COUNT);
  });

  /**
   * 写真が足りないぶんを同じ写真で埋めると
   * «見た目が同じで別ペア» のカードが生まれ、
   * プレイヤーには揃わないバグとしか見えない。
   * 静かに壊れるのではなく開始を断ることを固定する。
   */
  it('写真が足りない場合は盤面を作らず理由を返す', () => {
    const res = buildMemoryBoard(makePool(MEMORY_PAIR_COUNT - 1));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('NOT_ENOUGH_PHOTOS');
    expect(res.available).toBe(MEMORY_PAIR_COUNT - 1);
    expect(res.required).toBe(MEMORY_PAIR_COUNT);
  });

  it('写真が 0 枚でも例外にせず理由を返す', () => {
    const res = buildMemoryBoard([]);
    expect(res.ok).toBe(false);
  });

  it('ちょうど必要枚数なら生成できる', () => {
    const res = buildMemoryBoard(makePool(MEMORY_PAIR_COUNT));
    expect(res.ok).toBe(true);
  });

  it('同じ写真が 2 つのペアに使われない (見た目が同じ別ペアを作らない)', () => {
    for (let t = 0; t < 30; t++) {
      const res = buildMemoryBoard(makePool(20));
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const urls = res.board.photos.map((p) => p.url);
      expect(new Set(urls).size).toBe(urls.length);
    }
  });

  it('配置が毎回同じにならない (シャッフルされている)', () => {
    const pool = makePool(20);
    const layouts = new Set<string>();
    for (let t = 0; t < 20; t++) {
      const res = buildMemoryBoard(pool);
      if (res.ok) layouts.add(res.board.cards.join(','));
    }
    // 20 回試して全部同じ並びなら乱数が効いていない
    expect(layouts.size).toBeGreaterThan(1);
  });

  it('選ばれる写真が毎回同じにならない (プールから偏らず選ぶ)', () => {
    const pool = makePool(40);
    const picked = new Set<string>();
    for (let t = 0; t < 20; t++) {
      const res = buildMemoryBoard(pool);
      if (res.ok) for (const p of res.board.photos) picked.add(p.id);
    }
    // 8 ペア × 20 回で、40 枚のうち相当数が登場するはず
    expect(picked.size).toBeGreaterThan(MEMORY_PAIR_COUNT);
  });

  it('ペア数を指定して生成できる (将来の難易度変更に備える)', () => {
    const res = buildMemoryBoard(makePool(10), 3);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.board.photos).toHaveLength(3);
    expect(res.board.cards).toHaveLength(6);
    expect(isValidMemoryBoard(res.board)).toBe(true);
  });
});
