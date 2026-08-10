/**
 * ミニゲーム「スロット」純粋ロジックの単体テスト。
 *
 * 特に重点的に検証しているのは以下 3 点:
 *  1. 確率テーブルの区間割り当て (rollSlotOutcome) が仕様どおりか — 境界値で直接検証する。
 *     ここがズレると「設定を上げたのに出ない」「想定より Pui を配りすぎる」が起きる。
 *  2. 役 ⇄ 絵柄 の整合性 (reelsMatchOutcome / judgeSlotReels) —
 *     「はずれなのに 7 が 3 つ並ぶ」ような、プレイヤーから不正に見える表示を防ぐ。
 *  3. 設定を上げるほど当選率・期待値が単調増加すること — 運営が設定を上げたのに
 *     渋くなる、という事故を防ぐ。
 */
import {
  SLOT_SYMBOLS,
  SLOT_SYMBOL_EMOJI,
  SLOT_SYMBOL_LABEL,
  isSlotSymbol,
  SLOT_REEL_COUNT,
  SLOT_WINNING_OUTCOMES,
  SLOT_TRIPLE_SYMBOL,
  SLOT_OUTCOME_LABEL,
  SLOT_PAYOUT,
  SLOT_MAX_PLAYS_PER_DAY,
  SLOT_MAX_PAYOUT,
  SLOT_SETTINGS,
  SLOT_ODDS_BY_SETTING,
  isSlotSetting,
  clampSlotSetting,
  slotOdds,
  slotTotalWinRate,
  slotExpectedValue,
  rollSlotOutcome,
  slotPayout,
  isSlotWin,
  reelsMatchOutcome,
  judgeSlotReels,
  SLOT_SETTINGS_KEY,
  DEFAULT_SLOT_SETTINGS,
  SlotSettingsByPlanSchema,
  resolveSlotSettingForPlan,
  slotRemainingPlays,
  type SlotOutcome,
  type SlotReels,
  type SlotSetting,
} from './slot-game';

describe('絵柄', () => {
  it('6 種類の絵柄が定義されている', () => {
    expect(SLOT_SYMBOLS).toHaveLength(6);
    expect(new Set(SLOT_SYMBOLS).size).toBe(6);
  });

  it('全絵柄に絵文字と日本語ラベルがある (UI で欠落しない)', () => {
    for (const s of SLOT_SYMBOLS) {
      expect(SLOT_SYMBOL_EMOJI[s]).toBeTruthy();
      expect(SLOT_SYMBOL_LABEL[s]).toBeTruthy();
    }
  });

  it('isSlotSymbol は有効な絵柄だけ true', () => {
    expect(isSlotSymbol('SEVEN')).toBe(true);
    expect(isSlotSymbol('seven')).toBe(false);
    expect(isSlotSymbol('BANANA')).toBe(false);
    expect(isSlotSymbol(null)).toBe(false);
    expect(isSlotSymbol(7)).toBe(false);
  });

  it('リールは 3 本', () => {
    expect(SLOT_REEL_COUNT).toBe(3);
  });
});

describe('配当テーブル', () => {
  it('全役に配当が定義されている', () => {
    for (const o of SLOT_WINNING_OUTCOMES) {
      expect(SLOT_PAYOUT[o]).toBeGreaterThan(0);
    }
    expect(SLOT_PAYOUT.LOSE).toBe(0);
  });

  it('全役に日本語ラベルがある', () => {
    for (const o of [...SLOT_WINNING_OUTCOMES, 'LOSE' as SlotOutcome]) {
      expect(SLOT_OUTCOME_LABEL[o]).toBeTruthy();
    }
  });

  it('SLOT_WINNING_OUTCOMES は配当が高い順に並んでいる', () => {
    // rollSlotOutcome はこの順に区間を割り当てるため、順序が崩れると
    // 「高配当の役が抽選されない」といった事故になる。
    for (let i = 1; i < SLOT_WINNING_OUTCOMES.length; i++) {
      const prev = SLOT_PAYOUT[SLOT_WINNING_OUTCOMES[i - 1]];
      const cur = SLOT_PAYOUT[SLOT_WINNING_OUTCOMES[i]];
      expect(prev).toBeGreaterThan(cur);
    }
  });

  it('SLOT_MAX_PAYOUT は最高配当と一致する', () => {
    const max = Math.max(...SLOT_WINNING_OUTCOMES.map((o) => SLOT_PAYOUT[o]));
    expect(SLOT_MAX_PAYOUT).toBe(max);
  });

  it('slotPayout / isSlotWin が配当テーブルと整合する', () => {
    expect(slotPayout('SEVEN_TRIPLE')).toBe(SLOT_PAYOUT.SEVEN_TRIPLE);
    expect(slotPayout('LOSE')).toBe(0);
    expect(isSlotWin('SEVEN_TRIPLE')).toBe(true);
    expect(isSlotWin('CHERRY_SINGLE')).toBe(true);
    expect(isSlotWin('LOSE')).toBe(false);
  });

  it('1 日のプレイ上限はあっち向いてホイと同じ 5 回', () => {
    expect(SLOT_MAX_PLAYS_PER_DAY).toBe(5);
  });
});

describe('設定 (1〜6)', () => {
  it('6 段階ある', () => {
    expect(SLOT_SETTINGS).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('全設定に全役の確率が定義されている', () => {
    for (const s of SLOT_SETTINGS) {
      for (const o of SLOT_WINNING_OUTCOMES) {
        const p = SLOT_ODDS_BY_SETTING[s][o as Exclude<SlotOutcome, 'LOSE'>];
        expect(typeof p).toBe('number');
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThan(1);
      }
    }
  });

  it('どの設定でも当選率の合計は 1 未満 (= はずれが必ず存在する)', () => {
    for (const s of SLOT_SETTINGS) {
      expect(slotTotalWinRate(s)).toBeLessThan(1);
    }
  });

  it('どの設定でも当選率は 60% を超えない (射幸性を抑える)', () => {
    for (const s of SLOT_SETTINGS) {
      expect(slotTotalWinRate(s)).toBeLessThanOrEqual(0.6);
    }
  });

  it('設定が上がるほど当選率が単調増加する', () => {
    for (let i = 1; i < SLOT_SETTINGS.length; i++) {
      const lower = slotTotalWinRate(SLOT_SETTINGS[i - 1]);
      const higher = slotTotalWinRate(SLOT_SETTINGS[i]);
      expect(higher).toBeGreaterThan(lower);
    }
  });

  it('設定が上がるほど期待値 (獲得 Pui) が単調増加する', () => {
    for (let i = 1; i < SLOT_SETTINGS.length; i++) {
      const lower = slotExpectedValue(SLOT_SETTINGS[i - 1]);
      const higher = slotExpectedValue(SLOT_SETTINGS[i]);
      expect(higher).toBeGreaterThan(lower);
    }
  });

  it('各役も設定が上がるほど出やすくなる (逆転しない)', () => {
    for (const o of SLOT_WINNING_OUTCOMES) {
      const key = o as Exclude<SlotOutcome, 'LOSE'>;
      for (let i = 1; i < SLOT_SETTINGS.length; i++) {
        const lower = SLOT_ODDS_BY_SETTING[SLOT_SETTINGS[i - 1]][key];
        const higher = SLOT_ODDS_BY_SETTING[SLOT_SETTINGS[i]][key];
        expect(higher).toBeGreaterThan(lower);
      }
    }
  });

  it('1 日の期待獲得 Pui があっち向いてホイ (約40pt) と同程度の水準に収まる', () => {
    // 片方のゲームだけ極端に稼げる状態になっていないかの回帰テスト。
    // (あっち向いてホイ: 5回 × 25% × 32pt ≒ 40pt/日)
    for (const s of SLOT_SETTINGS) {
      const perDay = slotExpectedValue(s) * SLOT_MAX_PLAYS_PER_DAY;
      expect(perDay).toBeGreaterThan(0);
      expect(perDay).toBeLessThan(120);
    }
  });

  it('isSlotSetting は 1〜6 の整数だけ true', () => {
    expect(isSlotSetting(1)).toBe(true);
    expect(isSlotSetting(6)).toBe(true);
    expect(isSlotSetting(0)).toBe(false);
    expect(isSlotSetting(7)).toBe(false);
    expect(isSlotSetting('3')).toBe(false);
    expect(isSlotSetting(null)).toBe(false);
  });

  it('clampSlotSetting は範囲外を 1〜6 に丸める', () => {
    expect(clampSlotSetting(-5)).toBe(1);
    expect(clampSlotSetting(0)).toBe(1);
    expect(clampSlotSetting(3)).toBe(3);
    expect(clampSlotSetting(3.4)).toBe(3);
    expect(clampSlotSetting(3.6)).toBe(4);
    expect(clampSlotSetting(99)).toBe(6);
  });

  it('slotOdds は不正な設定でも設定1のテーブルにフォールバックする', () => {
    expect(slotOdds(99 as SlotSetting)).toBe(SLOT_ODDS_BY_SETTING[1]);
  });
});

describe('rollSlotOutcome (確率テーブルの区間割り当て)', () => {
  it('roll=0 は最高配当の役になる (区間の先頭)', () => {
    for (const s of SLOT_SETTINGS) {
      expect(rollSlotOutcome(0, s)).toBe(SLOT_WINNING_OUTCOMES[0]);
    }
  });

  it('roll が当選区間の合計以上なら必ず LOSE', () => {
    for (const s of SLOT_SETTINGS) {
      const total = slotTotalWinRate(s);
      expect(rollSlotOutcome(total, s)).toBe('LOSE');
      expect(rollSlotOutcome(total + 0.0001, s)).toBe('LOSE');
      expect(rollSlotOutcome(0.999999, s)).toBe('LOSE');
    }
  });

  it('各役の区間の境界値で、期待どおりの役が返る', () => {
    // 累積区間 [cursor, cursor+p) にその役が割り当てられていることを、
    // 区間の直前・直後の値で確認する (オフバイワンの検出)。
    for (const s of SLOT_SETTINGS) {
      const odds = slotOdds(s);
      let cursor = 0;
      for (const o of SLOT_WINNING_OUTCOMES) {
        const p = odds[o as Exclude<SlotOutcome, 'LOSE'>];
        // 区間の内側 (下端 & ほぼ上端) はその役
        expect(rollSlotOutcome(cursor, s)).toBe(o);
        expect(rollSlotOutcome(cursor + p * 0.999, s)).toBe(o);
        cursor += p;
        // 区間の上端ちょうどは「次の役」(または LOSE) に移る
        expect(rollSlotOutcome(cursor, s)).not.toBe(o);
      }
    }
  });

  it('全 roll 値の分布が確率テーブルとほぼ一致する (数値積分による検証)', () => {
    // 乱数を使わず [0,1) を等間隔にスキャンして各役の出現割合を数え、
    // 定義した確率と一致するかを確認する (実装ミスを決定論的に検出できる)。
    const STEPS = 100000;
    for (const s of SLOT_SETTINGS) {
      const counts = new Map<SlotOutcome, number>();
      for (let i = 0; i < STEPS; i++) {
        const o = rollSlotOutcome(i / STEPS, s);
        counts.set(o, (counts.get(o) ?? 0) + 1);
      }
      const odds = slotOdds(s);
      for (const o of SLOT_WINNING_OUTCOMES) {
        const actual = (counts.get(o) ?? 0) / STEPS;
        const expected = odds[o as Exclude<SlotOutcome, 'LOSE'>];
        expect(Math.abs(actual - expected)).toBeLessThan(0.001);
      }
    }
  });
});

describe('reelsMatchOutcome (絵柄と役の整合性チェック)', () => {
  it('3 つ揃い役は、その絵柄が 3 つ並んでいるときだけ true', () => {
    for (const [outcome, symbol] of Object.entries(SLOT_TRIPLE_SYMBOL)) {
      const o = outcome as SlotOutcome;
      expect(reelsMatchOutcome([symbol, symbol, symbol], o)).toBe(true);
      // 1 つでも違えば false
      expect(reelsMatchOutcome([symbol, symbol, 'CHERRY'], o)).toBe(false);
    }
  });

  it('3 つ揃い役に、別の絵柄の 3 つ揃いを渡すと false', () => {
    expect(reelsMatchOutcome(['BELL', 'BELL', 'BELL'], 'SEVEN_TRIPLE')).toBe(false);
  });

  it('CHERRY_SINGLE はチェリーを 1 つ以上含み、かつ 3 つ揃いでないとき true', () => {
    expect(reelsMatchOutcome(['CHERRY', 'BELL', 'STAR'], 'CHERRY_SINGLE')).toBe(true);
    expect(reelsMatchOutcome(['BELL', 'CHERRY', 'STAR'], 'CHERRY_SINGLE')).toBe(true);
    expect(reelsMatchOutcome(['CHERRY', 'CHERRY', 'STAR'], 'CHERRY_SINGLE')).toBe(true);
    // チェリー無し
    expect(reelsMatchOutcome(['BELL', 'STAR', 'SEVEN'], 'CHERRY_SINGLE')).toBe(false);
    // 3 つ揃いは役が重複するので不可
    expect(reelsMatchOutcome(['CHERRY', 'CHERRY', 'CHERRY'], 'CHERRY_SINGLE')).toBe(false);
  });

  it('LOSE は 3 つ揃いでもチェリー混入でもないとき true', () => {
    expect(reelsMatchOutcome(['BELL', 'STAR', 'SEVEN'], 'LOSE')).toBe(true);
    // 2 つ揃い (テンパイ外し) は、はずれとして許容する
    expect(reelsMatchOutcome(['BELL', 'BELL', 'STAR'], 'LOSE')).toBe(true);
    // チェリーが混ざったら小役なので LOSE にはできない
    expect(reelsMatchOutcome(['CHERRY', 'BELL', 'STAR'], 'LOSE')).toBe(false);
    // 3 つ揃いは当たりなので LOSE にはできない
    expect(reelsMatchOutcome(['SEVEN', 'SEVEN', 'SEVEN'], 'LOSE')).toBe(false);
  });
});

describe('judgeSlotReels (絵柄からの逆引き判定)', () => {
  it('3 つ揃いはその役になる', () => {
    for (const [outcome, symbol] of Object.entries(SLOT_TRIPLE_SYMBOL)) {
      expect(judgeSlotReels([symbol, symbol, symbol])).toBe(outcome);
    }
  });

  it('チェリーを含み 3 つ揃いでなければ CHERRY_SINGLE', () => {
    expect(judgeSlotReels(['CHERRY', 'BELL', 'STAR'])).toBe('CHERRY_SINGLE');
    expect(judgeSlotReels(['BELL', 'STAR', 'CHERRY'])).toBe('CHERRY_SINGLE');
  });

  it('チェリー 3 つ揃いは専用役が無いので CHERRY_SINGLE として扱う', () => {
    expect(judgeSlotReels(['CHERRY', 'CHERRY', 'CHERRY'])).toBe('CHERRY_SINGLE');
  });

  it('揃わずチェリーも無ければ LOSE', () => {
    expect(judgeSlotReels(['BELL', 'STAR', 'SEVEN'])).toBe('LOSE');
    expect(judgeSlotReels(['BELL', 'BELL', 'STAR'])).toBe('LOSE');
  });

  it('reelsMatchOutcome と judgeSlotReels は矛盾しない (全組み合わせを網羅)', () => {
    // 6^3 = 216 通りすべてを走査し、judge の結果が match でも true になることを確認する。
    // 2 つの判定関数が食い違うと、サーバーの自己検証がすり抜けてしまう。
    for (const a of SLOT_SYMBOLS) {
      for (const b of SLOT_SYMBOLS) {
        for (const c of SLOT_SYMBOLS) {
          const reels: SlotReels = [a, b, c];
          const judged = judgeSlotReels(reels);
          // チェリー 3 つ揃いだけは judge が CHERRY_SINGLE を返すが
          // reelsMatchOutcome は「3 つ揃いを CHERRY_SINGLE と認めない」ため例外扱い。
          const isCherryTriple = a === 'CHERRY' && b === 'CHERRY' && c === 'CHERRY';
          if (isCherryTriple) continue;
          expect(reelsMatchOutcome(reels, judged)).toBe(true);
        }
      }
    }
  });
});

describe('プラン別設定', () => {
  it('AppSetting のキーは slot.settings', () => {
    expect(SLOT_SETTINGS_KEY).toBe('slot.settings');
  });

  it('既定値は FREE 2 / STANDARD 4 / PREMIUM 6', () => {
    expect(DEFAULT_SLOT_SETTINGS).toEqual({ FREE: 2, STANDARD: 4, PREMIUM: 6 });
  });

  it('上位プランほど高設定になっている', () => {
    expect(DEFAULT_SLOT_SETTINGS.STANDARD).toBeGreaterThan(DEFAULT_SLOT_SETTINGS.FREE);
    expect(DEFAULT_SLOT_SETTINGS.PREMIUM).toBeGreaterThan(DEFAULT_SLOT_SETTINGS.STANDARD);
  });

  it('スキーマは既定値を受け入れる', () => {
    expect(SlotSettingsByPlanSchema.safeParse(DEFAULT_SLOT_SETTINGS).success).toBe(true);
  });

  it('スキーマは範囲外・欠損を弾く', () => {
    expect(
      SlotSettingsByPlanSchema.safeParse({ FREE: 0, STANDARD: 4, PREMIUM: 6 }).success,
    ).toBe(false);
    expect(
      SlotSettingsByPlanSchema.safeParse({ FREE: 2, STANDARD: 4, PREMIUM: 7 }).success,
    ).toBe(false);
    expect(SlotSettingsByPlanSchema.safeParse({ FREE: 2 }).success).toBe(false);
  });

  it('resolveSlotSettingForPlan はプランに対応する設定を返す', () => {
    expect(resolveSlotSettingForPlan(DEFAULT_SLOT_SETTINGS, 'FREE')).toBe(2);
    expect(resolveSlotSettingForPlan(DEFAULT_SLOT_SETTINGS, 'PREMIUM')).toBe(6);
  });

  it('resolveSlotSettingForPlan は値が欠けていても既定値にフォールバックする', () => {
    const broken = { FREE: 3 } as unknown as typeof DEFAULT_SLOT_SETTINGS;
    expect(resolveSlotSettingForPlan(broken, 'FREE')).toBe(3);
    expect(resolveSlotSettingForPlan(broken, 'PREMIUM')).toBe(
      DEFAULT_SLOT_SETTINGS.PREMIUM,
    );
  });
});

describe('slotRemainingPlays', () => {
  it('未プレイなら上限と同じ', () => {
    expect(slotRemainingPlays(0)).toBe(SLOT_MAX_PLAYS_PER_DAY);
  });

  it('途中なら残り回数を返す', () => {
    expect(slotRemainingPlays(2, 5)).toBe(3);
  });

  it('上限を超えても負にはならない', () => {
    expect(slotRemainingPlays(SLOT_MAX_PLAYS_PER_DAY + 3)).toBe(0);
  });

  it('追加プレイ購入で上限が増えた場合も正しく計算する', () => {
    expect(slotRemainingPlays(5, 8)).toBe(3);
  });
});
