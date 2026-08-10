/**
 * スロット — サーバー側解決ロジックの単体テスト。
 *
 * 暗号論的乱数を使うため、統計的性質 (概ねの分布) と、ルール上絶対に
 * 成り立つべき不変条件 (invariant) を中心に検証する。
 *
 * 最重要なのは「表示 (リールの絵柄) と結果 (役・配当) が絶対に食い違わない」こと。
 * ここが崩れると、プレイヤーからは不正 (出目と配当が合わない) に見えてしまう。
 */
import { buildReelsForOutcome, resolveSlotPlay } from './slot';
import {
  SLOT_PAYOUT,
  SLOT_SETTINGS,
  SLOT_TRIPLE_SYMBOL,
  SLOT_WINNING_OUTCOMES,
  judgeSlotReels,
  reelsMatchOutcome,
  slotTotalWinRate,
  type SlotOutcome,
} from '@idol/shared';

const ALL_OUTCOMES: SlotOutcome[] = [...SLOT_WINNING_OUTCOMES, 'LOSE'];

describe('buildReelsForOutcome (役に整合するリール絵柄の構成)', () => {
  it('どの役でも、構成した絵柄は必ずその役と整合する', () => {
    for (const outcome of ALL_OUTCOMES) {
      for (let i = 0; i < 300; i++) {
        const reels = buildReelsForOutcome(outcome);
        expect(reels).toHaveLength(3);
        expect(reelsMatchOutcome(reels, outcome)).toBe(true);
      }
    }
  });

  it('3 つ揃い役は、その絵柄が 3 つ並ぶ', () => {
    for (const [outcome, symbol] of Object.entries(SLOT_TRIPLE_SYMBOL)) {
      const reels = buildReelsForOutcome(outcome as SlotOutcome);
      expect(reels).toEqual([symbol, symbol, symbol]);
    }
  });

  it('CHERRY_SINGLE はチェリーを 1 つ含み、3 つ揃いにはならない', () => {
    for (let i = 0; i < 300; i++) {
      const reels = buildReelsForOutcome('CHERRY_SINGLE');
      const cherries = reels.filter((s) => s === 'CHERRY').length;
      expect(cherries).toBeGreaterThanOrEqual(1);
      const allSame = reels[0] === reels[1] && reels[1] === reels[2];
      expect(allSame).toBe(false);
    }
  });

  it('CHERRY_SINGLE のチェリーは左・中・右のいずれの位置にも出る (位置が固定されていない)', () => {
    // 常に同じ位置だと「チェリーは必ず左」とバレて演出が単調になる。
    const positions = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const reels = buildReelsForOutcome('CHERRY_SINGLE');
      reels.forEach((s, idx) => {
        if (s === 'CHERRY') positions.add(idx);
      });
    }
    expect(positions).toEqual(new Set([0, 1, 2]));
  });

  it('LOSE はチェリーを含まず、3 つ揃いにもならない', () => {
    for (let i = 0; i < 500; i++) {
      const reels = buildReelsForOutcome('LOSE');
      expect(reels).not.toContain('CHERRY');
      const allSame = reels[0] === reels[1] && reels[1] === reels[2];
      expect(allSame).toBe(false);
      // 逆引き判定でも必ず LOSE になる
      expect(judgeSlotReels(reels)).toBe('LOSE');
    }
  });

  it('LOSE でも「2 つ揃い (テンパイ外し)」は発生しうる (演出として許容)', () => {
    let sawPair = false;
    for (let i = 0; i < 500; i++) {
      const reels = buildReelsForOutcome('LOSE');
      const uniq = new Set(reels).size;
      if (uniq === 2) sawPair = true;
    }
    expect(sawPair).toBe(true);
  });
});

describe('resolveSlotPlay (1 プレイの解決)', () => {
  it('役・絵柄・配当が常に整合する', () => {
    for (const setting of SLOT_SETTINGS) {
      for (let i = 0; i < 400; i++) {
        const play = resolveSlotPlay(setting);
        // 絵柄が役と矛盾していない
        expect(reelsMatchOutcome(play.reels, play.outcome)).toBe(true);
        // 配当が配当テーブルと一致する
        expect(play.payout).toBe(SLOT_PAYOUT[play.outcome]);
        // 使用した設定をそのまま返す (監査ログ用)
        expect(play.setting).toBe(setting);
      }
    }
  });

  it('はずれのときは配当が必ず 0 (誤って Pui を配らない)', () => {
    for (let i = 0; i < 1000; i++) {
      const play = resolveSlotPlay(1);
      if (play.outcome === 'LOSE') {
        expect(play.payout).toBe(0);
      } else {
        expect(play.payout).toBeGreaterThan(0);
      }
    }
  });

  it('絵柄からの逆引き判定が、抽選された役と一致する (チェリー3つ揃いは構成されない)', () => {
    for (const setting of SLOT_SETTINGS) {
      for (let i = 0; i < 300; i++) {
        const play = resolveSlotPlay(setting);
        expect(judgeSlotReels(play.reels)).toBe(play.outcome);
      }
    }
  });

  it('設定 (1〜6) の当選率が実際の出現率に反映される (統計的検証)', () => {
    const trials = 20000;
    const winRate = (setting: (typeof SLOT_SETTINGS)[number]): number => {
      let wins = 0;
      for (let i = 0; i < trials; i++) {
        if (resolveSlotPlay(setting).outcome !== 'LOSE') wins++;
      }
      return wins / trials;
    };

    const low = winRate(1);
    const high = winRate(6);

    // 設定 6 のほうが明確に当たりやすい
    expect(high).toBeGreaterThan(low);
    // 定義した確率から大きく外れていない (±3 ポイント程度の許容)
    expect(Math.abs(low - slotTotalWinRate(1))).toBeLessThan(0.03);
    expect(Math.abs(high - slotTotalWinRate(6))).toBeLessThan(0.03);
  });

  it('最高配当 (セブン揃い) は極めて稀にしか出ない (低設定)', () => {
    // 設定1 のセブン確率は 0.2%。5000 回で 50 回を超えるようなら実装ミス。
    let sevens = 0;
    for (let i = 0; i < 5000; i++) {
      if (resolveSlotPlay(1).outcome === 'SEVEN_TRIPLE') sevens++;
    }
    expect(sevens).toBeLessThan(50);
  });

  it('十分な試行で全役が出現する (どの役も抽選から漏れていない)', () => {
    const seen = new Set<SlotOutcome>();
    for (let i = 0; i < 20000; i++) {
      seen.add(resolveSlotPlay(6).outcome);
    }
    for (const o of ALL_OUTCOMES) {
      expect(seen.has(o)).toBe(true);
    }
  });
});
