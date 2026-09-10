import { DEFAULT_PUI_RATES, type PuiRateSettings } from './membership';
import { buildLoginBonusAppInfo } from './login-bonus-app';

const rates = DEFAULT_PUI_RATES; // base 10 / streakBonus 50 / threshold 7

describe('buildLoginBonusAppInfo — 付与額', () => {
  it('【最重要】実際の付与ロジックと一致する（要望の想定値ではない）', () => {
    // 要望では [10,10,10,20,20,20,50] とあったが、実装は
    // 「毎日 base、7日目だけ +streakBonus」なので [10,...,60] が正しい。
    // ここを固定値にすると «表示は 20 なのに 10 しか増えない» 不信を招く。
    const info = buildLoginBonusAppInfo({
      streak: 0,
      claimedToday: false,
      plan: 'FREE',
      rates,
    });
    expect(info.schedule).toEqual([10, 10, 10, 10, 10, 10, 60]);
  });

  it('7 日目が節目として立つ', () => {
    const info = buildLoginBonusAppInfo({
      streak: 0,
      claimedToday: false,
      plan: 'FREE',
      rates,
    });
    expect(info.days[6]!.isMilestone).toBe(true);
    expect(info.days.slice(0, 6).every((d) => !d.isMilestone)).toBe(true);
  });

  it('プラン倍率が反映される（PREMIUM は 2 倍）', () => {
    const free = buildLoginBonusAppInfo({ streak: 0, claimedToday: false, plan: 'FREE', rates });
    const premium = buildLoginBonusAppInfo({
      streak: 0,
      claimedToday: false,
      plan: 'PREMIUM',
      rates,
    });
    expect(free.schedule).toEqual([10, 10, 10, 10, 10, 10, 60]);
    expect(premium.schedule).toEqual([20, 20, 20, 20, 20, 20, 120]);
    expect(premium.planMultiplier).toBe(2);
  });

  it('STANDARD は 1.2 倍（端数は四捨五入）', () => {
    const info = buildLoginBonusAppInfo({
      streak: 0,
      claimedToday: false,
      plan: 'STANDARD',
      rates,
    });
    // 10 * 1.2 = 12 / 60 * 1.2 = 72
    expect(info.schedule).toEqual([12, 12, 12, 12, 12, 12, 72]);
  });

  it('レート設定を変えれば schedule も変わる（固定値ではない）', () => {
    const custom: PuiRateSettings = {
      loginBonusBase: 5,
      loginStreakBonus: 100,
      loginStreakThreshold: 3,
      socialSharePui: 20,
    };
    const info = buildLoginBonusAppInfo({
      streak: 0,
      claimedToday: false,
      plan: 'FREE',
      rates: custom,
    });
    expect(info.cycleLength).toBe(3);
    expect(info.schedule).toEqual([5, 5, 105]);
  });
});

describe('buildLoginBonusAppInfo — 未受取のとき', () => {
  it('streak=0（初回）なら 1 日目が today', () => {
    const info = buildLoginBonusAppInfo({
      streak: 0,
      claimedToday: false,
      plan: 'FREE',
      rates,
    });
    expect(info.cyclePosition).toBe(1);
    expect(info.days[0]!.state).toBe('today');
    expect(info.nextAmount).toBe(10);
  });

  it('streak=3 なら 4 日目が today（今日受け取れば 4 日連続）', () => {
    const info = buildLoginBonusAppInfo({
      streak: 3,
      claimedToday: false,
      plan: 'FREE',
      rates,
    });
    expect(info.cyclePosition).toBe(4);
    expect(info.days[3]!.state).toBe('today');
    // 1〜3 日目は受取済み
    expect(info.days.slice(0, 3).every((d) => d.state === 'claimed')).toBe(true);
    // 5 日目以降は未来
    expect(info.days.slice(4).every((d) => d.state === 'upcoming')).toBe(true);
  });

  it('streak=6 なら 7 日目（節目）が today で nextAmount が 60', () => {
    const info = buildLoginBonusAppInfo({
      streak: 6,
      claimedToday: false,
      plan: 'FREE',
      rates,
    });
    expect(info.cyclePosition).toBe(7);
    expect(info.nextAmount).toBe(60);
    expect(info.days[6]!.state).toBe('today');
  });

  it('streak=7 を超えたら次サイクルの 1 日目に戻る', () => {
    // 7 日受取済みで未受取 → 今日は 8 日目 = 次サイクル 1 日目
    const info = buildLoginBonusAppInfo({
      streak: 7,
      claimedToday: false,
      plan: 'FREE',
      rates,
    });
    expect(info.cyclePosition).toBe(1);
    expect(info.nextAmount).toBe(10);
  });
});

describe('buildLoginBonusAppInfo — 受取済みのとき', () => {
  it('今日受取済みなら today が無く、次の額を返す', () => {
    // streak=3 で受取済み → 3 日目まで claimed、次は 4 日目
    const info = buildLoginBonusAppInfo({
      streak: 3,
      claimedToday: true,
      plan: 'FREE',
      rates,
    });
    expect(info.days.some((d) => d.state === 'today')).toBe(false);
    expect(info.days.slice(0, 3).every((d) => d.state === 'claimed')).toBe(true);
    expect(info.nextAmount).toBe(10); // 4 日目
  });

  it('6 日目まで受取済みなら「次は 60」と分かる（明日が節目）', () => {
    const info = buildLoginBonusAppInfo({
      streak: 6,
      claimedToday: true,
      plan: 'FREE',
      rates,
    });
    // アプリで「明日は 60 Pui!」と出せる
    expect(info.nextAmount).toBe(60);
  });

  it('7 日目（節目）を受取済みなら次サイクル 1 日目の額に戻る', () => {
    const info = buildLoginBonusAppInfo({
      streak: 7,
      claimedToday: true,
      plan: 'FREE',
      rates,
    });
    expect(info.days.every((d) => d.state === 'claimed')).toBe(true);
    expect(info.nextAmount).toBe(10);
  });

  it('PREMIUM で 6 日目まで受取済みなら次は 120', () => {
    const info = buildLoginBonusAppInfo({
      streak: 6,
      claimedToday: true,
      plan: 'PREMIUM',
      rates,
    });
    expect(info.nextAmount).toBe(120);
  });
});

describe('buildLoginBonusAppInfo — 壊れにくさ', () => {
  it('schedule の長さは常に cycleLength と一致する', () => {
    for (const streak of [0, 1, 5, 7, 8, 100]) {
      for (const claimed of [true, false]) {
        const info = buildLoginBonusAppInfo({
          streak,
          claimedToday: claimed,
          plan: 'FREE',
          rates,
        });
        expect(info.schedule).toHaveLength(info.cycleLength);
        expect(info.days).toHaveLength(info.cycleLength);
      }
    }
  });

  it('cyclePosition は 1..cycleLength の範囲に収まる', () => {
    for (const streak of [0, 1, 6, 7, 8, 14, 999]) {
      for (const claimed of [true, false]) {
        const info = buildLoginBonusAppInfo({
          streak,
          claimedToday: claimed,
          plan: 'FREE',
          rates,
        });
        expect(info.cyclePosition).toBeGreaterThanOrEqual(1);
        expect(info.cyclePosition).toBeLessThanOrEqual(info.cycleLength);
      }
    }
  });

  it('nextAmount は必ず schedule に含まれる値', () => {
    for (const streak of [0, 3, 6, 7, 13]) {
      for (const claimed of [true, false]) {
        const info = buildLoginBonusAppInfo({
          streak,
          claimedToday: claimed,
          plan: 'PREMIUM',
          rates,
        });
        expect(info.schedule).toContain(info.nextAmount);
      }
    }
  });

  it('連続ボーナスが 0 の設定でも落ちない', () => {
    const noBonus: PuiRateSettings = {
      loginBonusBase: 10,
      loginStreakBonus: 0,
      loginStreakThreshold: 7,
      socialSharePui: 20,
    };
    const info = buildLoginBonusAppInfo({
      streak: 6,
      claimedToday: false,
      plan: 'FREE',
      rates: noBonus,
    });
    expect(info.schedule).toEqual([10, 10, 10, 10, 10, 10, 10]);
    expect(info.days[6]!.isMilestone).toBe(false);
  });

  it('threshold が 1 でも落ちない（毎日が節目）', () => {
    const daily: PuiRateSettings = {
      loginBonusBase: 10,
      loginStreakBonus: 5,
      loginStreakThreshold: 1,
      socialSharePui: 20,
    };
    const info = buildLoginBonusAppInfo({
      streak: 0,
      claimedToday: false,
      plan: 'FREE',
      rates: daily,
    });
    expect(info.cycleLength).toBe(1);
    expect(info.schedule).toEqual([15]);
  });

  it('全ての金額が 0 以上の整数', () => {
    const info = buildLoginBonusAppInfo({
      streak: 2,
      claimedToday: false,
      plan: 'STANDARD',
      rates,
    });
    for (const a of info.schedule) {
      expect(Number.isInteger(a)).toBe(true);
      expect(a).toBeGreaterThanOrEqual(0);
    }
  });
});
