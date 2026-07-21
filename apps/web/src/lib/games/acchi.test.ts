/**
 * あっち向いてホイ — サーバー側解決ロジック (方向対決 1 ラウンドのみ) の単体テスト。
 *
 * 暗号論的乱数を使うため、統計的性質 (概ねの分布) と、ルール上絶対に
 * 成り立つべき不変条件 (invariant) を中心に検証する。
 */
import { resolveAcchiPlay } from './acchi';
import type { AcchiDirection } from '@idol/shared';

const DIRECTIONS: AcchiDirection[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

describe('resolveAcchiPlay (方向対決 1 ラウンドのみ)', () => {
  it('方向対決の player は常にプレイヤーが指した方向を反映する', () => {
    for (const dir of DIRECTIONS) {
      const play = resolveAcchiPlay(dir, 3);
      expect(play.direction.player).toBe(dir);
      expect(DIRECTIONS).toContain(play.direction.cpu);
    }
  });

  it('matched と result が整合する', () => {
    for (let i = 0; i < 500; i++) {
      const play = resolveAcchiPlay('UP', 3);
      expect(play.direction.matched).toBe(play.direction.player === play.direction.cpu);
      expect(play.result).toBe(play.direction.matched ? 'WIN' : 'LOSE');
    }
  });

  it('最終結果は常に WIN か LOSE のいずれか', () => {
    for (let i = 0; i < 300; i++) {
      const play = resolveAcchiPlay('LEFT', 4);
      expect(['WIN', 'LOSE']).toContain(play.result);
    }
  });

  it('不一致のとき CPU の方向は必ずプレイヤーの方向と異なる', () => {
    for (let i = 0; i < 300; i++) {
      const play = resolveAcchiPlay('DOWN', 1); // 勝率 0.2 (不一致が多い)
      if (!play.direction.matched) {
        expect(play.direction.cpu).not.toBe(play.direction.player);
      } else {
        expect(play.direction.cpu).toBe(play.direction.player);
      }
    }
  });

  it('設定 (1〜6) の勝率が一致率に反映される (統計的検証)', () => {
    const trials = 4000;
    let matchedLowSetting = 0;
    let matchedHighSetting = 0;

    for (let i = 0; i < trials; i++) {
      const lowPlay = resolveAcchiPlay('UP', 1); // 勝率 0.2
      if (lowPlay.direction.matched) matchedLowSetting++;

      const highPlay = resolveAcchiPlay('UP', 6); // 勝率 0.6
      if (highPlay.direction.matched) matchedHighSetting++;
    }

    // 設定6の一致数は設定1より明確に多いはず (十分なサンプル数で余裕を持った比較)
    expect(matchedHighSetting).toBeGreaterThan(matchedLowSetting);
  });
});
