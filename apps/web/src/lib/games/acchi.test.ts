/**
 * あっち向いてホイ — サーバー側解決ロジック (2ラウンド制) の単体テスト。
 *
 * 暗号論的乱数を使うため、統計的性質 (概ねの分布) と、ルール上絶対に
 * 成り立つべき不変条件 (invariant) を中心に検証する。
 */
import { resolveAcchiPlay } from './acchi';
import { judgeJanken } from '@idol/shared';
import type { JankenHand, AcchiDirection } from '@idol/shared';

const HANDS: JankenHand[] = ['ROCK', 'SCISSORS', 'PAPER'];
const DIRECTIONS: AcchiDirection[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

describe('resolveAcchiPlay (2ラウンド制)', () => {
  it('ラウンド1の各試行はプレイヤーの手を常に反映する', () => {
    for (const hand of HANDS) {
      const play = resolveAcchiPlay(hand, 'UP', 3);
      for (const attempt of play.round1.attempts) {
        expect(attempt.player).toBe(hand);
        expect(judgeJanken(attempt.player, attempt.cpu)).toBe(attempt.outcome);
      }
    }
  });

  it('ラウンド1の決着試行は attempts の最後の要素と一致し、DRAW ではない', () => {
    for (let i = 0; i < 200; i++) {
      const play = resolveAcchiPlay('ROCK', 'UP', 3);
      const attempts = play.round1.attempts;
      const decisive = attempts[attempts.length - 1];
      expect(decisive.outcome).not.toBe('DRAW');
      // 最後以外は全てDRAW (やり直し) のはず
      for (const a of attempts.slice(0, -1)) {
        expect(a.outcome).toBe('DRAW');
      }
    }
  });

  it('ラウンド1で負けたら round2 は null、result は LOSE', () => {
    for (let i = 0; i < 500; i++) {
      const play = resolveAcchiPlay('ROCK', 'UP', 3);
      const decisive = play.round1.attempts[play.round1.attempts.length - 1];
      if (decisive.outcome === 'LOSE') {
        expect(play.round2).toBeNull();
        expect(play.result).toBe('LOSE');
      }
    }
  });

  it('ラウンド1で勝ったら round2 が必ず存在し、matched と result が整合する', () => {
    for (let i = 0; i < 500; i++) {
      const play = resolveAcchiPlay('ROCK', 'UP', 3);
      const decisive = play.round1.attempts[play.round1.attempts.length - 1];
      if (decisive.outcome === 'WIN') {
        expect(play.round2).not.toBeNull();
        if (play.round2) {
          expect(play.round2.player).toBe('UP');
          expect(DIRECTIONS).toContain(play.round2.cpu);
          expect(play.round2.matched).toBe(play.round2.player === play.round2.cpu);
          expect(play.result).toBe(play.round2.matched ? 'WIN' : 'LOSE');
        }
      }
    }
  });

  it('最終結果は常に WIN か LOSE のいずれか (DRAW は出ない)', () => {
    for (let i = 0; i < 300; i++) {
      const play = resolveAcchiPlay('SCISSORS', 'LEFT', 4);
      expect(['WIN', 'LOSE']).toContain(play.result);
    }
  });

  it('ラウンド1の決着後の勝率は設定に依らず概ね50% (公正なじゃんけん: あいこを除けば勝敗は1/2ずつ)', () => {
    const trials = 3000;
    let advanced = 0;
    for (let i = 0; i < trials; i++) {
      const play = resolveAcchiPlay('PAPER', 'DOWN', 3);
      if (play.round2) advanced++;
    }
    const rate = advanced / trials;
    // 各試行は WIN/LOSE/DRAW が概ね1/3ずつ (公正) で、DRAW は単純にやり直すだけなので、
    // 決着 (WIN or LOSE) した時点での WIN 率は約 1/2 になる。
    expect(rate).toBeGreaterThan(0.4);
    expect(rate).toBeLessThan(0.6);
  });

  it('設定 (1〜6) の勝率がラウンド2の一致率に反映される (統計的検証)', () => {
    const trials = 4000;
    let matchedLowSetting = 0;
    let matchedHighSetting = 0;

    for (let i = 0; i < trials; i++) {
      const lowPlay = resolveAcchiPlay('ROCK', 'UP', 1); // 勝率 0.2
      if (lowPlay.round2?.matched) matchedLowSetting++;

      const highPlay = resolveAcchiPlay('ROCK', 'UP', 6); // 勝率 0.6
      if (highPlay.round2?.matched) matchedHighSetting++;
    }

    // 設定6の一致数は設定1より明確に多いはず (十分なサンプル数で余裕を持った比較)
    expect(matchedHighSetting).toBeGreaterThan(matchedLowSetting);
  });
});
