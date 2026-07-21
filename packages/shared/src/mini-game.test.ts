/**
 * ミニゲーム「あっち向いてホイ」純粋ロジックの単体テスト
 */
import {
  judgeAcchiResult,
  isAcchiDirection,
  remainingPlays,
  ACCHI_MAX_PLAYS_PER_DAY,
  ACCHI_WIN_REWARD,
  ACCHI_WIN_SETTINGS,
  ACCHI_WIN_RATE_BY_SETTING,
  isAcchiWinSetting,
  clampAcchiWinSetting,
  acchiWinRate,
  resolveAcchiSettingForPlan,
  DEFAULT_ACCHI_WIN_SETTINGS,
  AcchiWinSettingsByPlanSchema,
} from './mini-game';

describe('judgeAcchiResult (方向の一致/不一致からの最終結果)', () => {
  it('一致すればプレイヤーの勝ち', () => {
    expect(judgeAcchiResult(true)).toBe('WIN');
  });

  it('不一致であればプレイヤーの負け', () => {
    expect(judgeAcchiResult(false)).toBe('LOSE');
  });
});

describe('isAcchiDirection', () => {
  it('有効な方向だけ true', () => {
    expect(isAcchiDirection('UP')).toBe(true);
    expect(isAcchiDirection('up')).toBe(false);
    expect(isAcchiDirection(null)).toBe(false);
  });
});

describe('remainingPlays', () => {
  it('未プレイなら上限と同じ', () => {
    expect(remainingPlays(0)).toBe(ACCHI_MAX_PLAYS_PER_DAY);
  });

  it('上限を超えても負にはならない', () => {
    expect(remainingPlays(ACCHI_MAX_PLAYS_PER_DAY + 3)).toBe(0);
  });

  it('途中なら残り回数を返す', () => {
    expect(remainingPlays(2, 5)).toBe(3);
  });
});

describe('定数', () => {
  it('報酬と上限は正の整数', () => {
    expect(Number.isInteger(ACCHI_WIN_REWARD)).toBe(true);
    expect(ACCHI_WIN_REWARD).toBeGreaterThan(0);
    expect(Number.isInteger(ACCHI_MAX_PLAYS_PER_DAY)).toBe(true);
    expect(ACCHI_MAX_PLAYS_PER_DAY).toBeGreaterThan(0);
  });
});

describe('勝率設定 (1〜6)', () => {
  it('設定は 1〜6 の 6 段階', () => {
    expect(ACCHI_WIN_SETTINGS).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('各設定の勝率は 0〜1 で、設定が大きいほど高い (単調増加)', () => {
    let prev = -1;
    for (const s of ACCHI_WIN_SETTINGS) {
      const rate = ACCHI_WIN_RATE_BY_SETTING[s];
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
      expect(rate).toBeGreaterThan(prev); // 単調増加
      prev = rate;
    }
  });

  it('acchiWinRate は対応表と一致', () => {
    for (const s of ACCHI_WIN_SETTINGS) {
      expect(acchiWinRate(s)).toBe(ACCHI_WIN_RATE_BY_SETTING[s]);
    }
  });

  it('isAcchiWinSetting は 1〜6 のみ true', () => {
    expect(isAcchiWinSetting(1)).toBe(true);
    expect(isAcchiWinSetting(6)).toBe(true);
    expect(isAcchiWinSetting(0)).toBe(false);
    expect(isAcchiWinSetting(7)).toBe(false);
    expect(isAcchiWinSetting(3.5)).toBe(false);
    expect(isAcchiWinSetting('3')).toBe(false);
    expect(isAcchiWinSetting(null)).toBe(false);
  });

  it('clampAcchiWinSetting は範囲外を 1〜6 に丸める', () => {
    expect(clampAcchiWinSetting(0)).toBe(1);
    expect(clampAcchiWinSetting(-5)).toBe(1);
    expect(clampAcchiWinSetting(7)).toBe(6);
    expect(clampAcchiWinSetting(100)).toBe(6);
    expect(clampAcchiWinSetting(3)).toBe(3);
    expect(clampAcchiWinSetting(4.4)).toBe(4);
  });

  it('既定値: FREE < STANDARD < PREMIUM (上位ほど勝ちやすい)', () => {
    expect(DEFAULT_ACCHI_WIN_SETTINGS.FREE).toBeLessThan(
      DEFAULT_ACCHI_WIN_SETTINGS.STANDARD,
    );
    expect(DEFAULT_ACCHI_WIN_SETTINGS.STANDARD).toBeLessThan(
      DEFAULT_ACCHI_WIN_SETTINGS.PREMIUM,
    );
  });

  it('resolveAcchiSettingForPlan はプランの設定を返す', () => {
    const settings = { FREE: 1, STANDARD: 3, PREMIUM: 6 } as const;
    expect(resolveAcchiSettingForPlan(settings, 'FREE')).toBe(1);
    expect(resolveAcchiSettingForPlan(settings, 'STANDARD')).toBe(3);
    expect(resolveAcchiSettingForPlan(settings, 'PREMIUM')).toBe(6);
  });

  it('AcchiWinSettingsByPlanSchema は 1〜6 のみ許可', () => {
    expect(
      AcchiWinSettingsByPlanSchema.safeParse({ FREE: 2, STANDARD: 4, PREMIUM: 6 })
        .success,
    ).toBe(true);
    expect(
      AcchiWinSettingsByPlanSchema.safeParse({ FREE: 0, STANDARD: 4, PREMIUM: 6 })
        .success,
    ).toBe(false);
    expect(
      AcchiWinSettingsByPlanSchema.safeParse({ FREE: 2, STANDARD: 7, PREMIUM: 6 })
        .success,
    ).toBe(false);
    // プラン欠落は不可
    expect(
      AcchiWinSettingsByPlanSchema.safeParse({ FREE: 2, STANDARD: 4 }).success,
    ).toBe(false);
  });
});

