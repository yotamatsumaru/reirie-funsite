/**
 * 会員カード & ポイント機能の共有ロジックの単体テスト
 */
import {
  formatMemberNumber,
  jstDateKey,
  previousJstDateKey,
  computeLoginBonusAmount,
  buildLoginBonusCalendar,
  DEFAULT_PUI_RATES,
  PuiRateSettingsSchema,
  SocialShareInputSchema,
  AdminAdjustPuiSchema,
  isValidPuiAmount,
  isPuiBalanceConsistent,
  MAX_PUI_PER_TX,
} from './membership';

describe('formatMemberNumber', () => {
  it('連番をゼロ埋めして RR- プレフィックスを付ける', () => {
    expect(formatMemberNumber(1)).toBe('RR-000001');
    expect(formatMemberNumber(123)).toBe('RR-000123');
    expect(formatMemberNumber(999999)).toBe('RR-999999');
  });
  it('桁あふれしてもそのまま連結する', () => {
    expect(formatMemberNumber(1234567)).toBe('RR-1234567');
  });
});

describe('jstDateKey', () => {
  it('UTC の日付を JST に補正する (UTC 15:00 -> 翌日 JST)', () => {
    // 2026-06-24T15:30:00Z は JST で 2026-06-25 00:30
    expect(jstDateKey(new Date('2026-06-24T15:30:00Z'))).toBe('2026-06-25');
  });
  it('JST の同日内は同じキーになる', () => {
    expect(jstDateKey(new Date('2026-06-24T00:00:00Z'))).toBe('2026-06-24');
    expect(jstDateKey(new Date('2026-06-24T14:59:00Z'))).toBe('2026-06-24');
  });
});

describe('previousJstDateKey', () => {
  it('前日を返す', () => {
    expect(previousJstDateKey('2026-06-25')).toBe('2026-06-24');
  });
  it('月またぎを正しく扱う', () => {
    expect(previousJstDateKey('2026-07-01')).toBe('2026-06-30');
  });
  it('年またぎを正しく扱う', () => {
    expect(previousJstDateKey('2026-01-01')).toBe('2025-12-31');
  });
});

describe('computeLoginBonusAmount', () => {
  const rates = DEFAULT_PUI_RATES;
  it('通常日は基本ポイント', () => {
    expect(computeLoginBonusAmount(1, rates)).toBe(10);
    expect(computeLoginBonusAmount(6, rates)).toBe(10);
  });
  it('連続 7 日目に連続ボーナスを上乗せ', () => {
    expect(computeLoginBonusAmount(7, rates)).toBe(60); // 10 + 50
  });
  it('連続 14 日目 (閾値の倍数) でも上乗せ', () => {
    expect(computeLoginBonusAmount(14, rates)).toBe(60);
  });
  it('連続ボーナスが 0 の設定なら上乗せしない', () => {
    expect(
      computeLoginBonusAmount(7, { ...rates, loginStreakBonus: 0 }),
    ).toBe(10);
  });
});

describe('DEFAULT_PUI_RATES', () => {
  it('ユーザー指定のデフォルト値', () => {
    expect(DEFAULT_PUI_RATES.loginBonusBase).toBe(10);
    expect(DEFAULT_PUI_RATES.loginStreakBonus).toBe(50);
    expect(DEFAULT_PUI_RATES.loginStreakThreshold).toBe(7);
    expect(DEFAULT_PUI_RATES.socialSharePui).toBe(20);
  });
  it('スキーマでパース可能', () => {
    expect(PuiRateSettingsSchema.safeParse(DEFAULT_PUI_RATES).success).toBe(true);
  });
});

describe('buildLoginBonusCalendar', () => {
  const rates = DEFAULT_PUI_RATES; // threshold 7, base 10, bonus 50

  it('7 日分を返す', () => {
    expect(buildLoginBonusCalendar(1, false, rates)).toHaveLength(7);
  });

  it('7日目が節目で base+bonus、それ以外は base', () => {
    const days = buildLoginBonusCalendar(1, false, rates);
    expect(days[0]!.amount).toBe(10);
    expect(days[6]!.amount).toBe(60); // 10 + 50
    expect(days[6]!.isMilestone).toBe(true);
    expect(days[0]!.isMilestone).toBe(false);
  });

  it('未受取: 現在位置が today、前は claimed、後は upcoming', () => {
    // streak=4 (受け取れば4日目) / 今日未受取
    const days = buildLoginBonusCalendar(4, false, rates);
    expect(days[0]!.state).toBe('claimed');
    expect(days[2]!.state).toBe('claimed');
    expect(days[3]!.state).toBe('today'); // 4日目
    expect(days[4]!.state).toBe('upcoming');
  });

  it('受取済み: 現在位置までが claimed、後は upcoming (today無し)', () => {
    const days = buildLoginBonusCalendar(4, true, rates);
    expect(days[3]!.state).toBe('claimed'); // 4日目まで受取済み
    expect(days.some((d) => d.state === 'today')).toBe(false);
    expect(days[4]!.state).toBe('upcoming');
  });

  it('streak=7 はサイクル末尾(7日目)を指す', () => {
    const days = buildLoginBonusCalendar(7, false, rates);
    expect(days[6]!.state).toBe('today');
  });

  it('streak=8 は次サイクルの1日目に戻る', () => {
    const days = buildLoginBonusCalendar(8, false, rates);
    expect(days[0]!.state).toBe('today');
  });

  it('streak=0 でも1日目を today にする', () => {
    const days = buildLoginBonusCalendar(0, false, rates);
    expect(days[0]!.state).toBe('today');
  });
});

describe('SocialShareInputSchema', () => {
  it('X / INSTAGRAM を許可', () => {
    expect(SocialShareInputSchema.safeParse({ platform: 'X' }).success).toBe(true);
    expect(SocialShareInputSchema.safeParse({ platform: 'INSTAGRAM' }).success).toBe(true);
  });
  it('未知のプラットフォームは拒否', () => {
    expect(SocialShareInputSchema.safeParse({ platform: 'FACEBOOK' }).success).toBe(false);
  });
});

describe('AdminAdjustPuiSchema', () => {
  it('0 以外の増減を許可', () => {
    expect(
      AdminAdjustPuiSchema.safeParse({
        userId: '00000000-0000-0000-0000-000000000000',
        amount: 100,
      }).success,
    ).toBe(true);
  });
  it('0 は拒否', () => {
    expect(
      AdminAdjustPuiSchema.safeParse({
        userId: '00000000-0000-0000-0000-000000000000',
        amount: 0,
      }).success,
    ).toBe(false);
  });
});

describe('isValidPuiAmount', () => {
  it('通常の正の整数を許可', () => {
    expect(isValidPuiAmount(10)).toBe(true);
    expect(isValidPuiAmount(1)).toBe(true);
  });
  it('負の整数も許可 (消費/管理者調整)', () => {
    expect(isValidPuiAmount(-50)).toBe(true);
  });
  it('0 は拒否', () => {
    expect(isValidPuiAmount(0)).toBe(false);
  });
  it('小数は拒否', () => {
    expect(isValidPuiAmount(10.5)).toBe(false);
  });
  it('NaN / Infinity は拒否', () => {
    expect(isValidPuiAmount(NaN)).toBe(false);
    expect(isValidPuiAmount(Infinity)).toBe(false);
  });
  it('上限ちょうどは許可、超過は拒否', () => {
    expect(isValidPuiAmount(MAX_PUI_PER_TX)).toBe(true);
    expect(isValidPuiAmount(-MAX_PUI_PER_TX)).toBe(true);
    expect(isValidPuiAmount(MAX_PUI_PER_TX + 1)).toBe(false);
  });
});

describe('isPuiBalanceConsistent', () => {
  it('残高と台帳合計が一致し 0 以上なら整合', () => {
    expect(isPuiBalanceConsistent(100, 100)).toBe(true);
    expect(isPuiBalanceConsistent(0, 0)).toBe(true);
  });
  it('残高と台帳合計が不一致なら不整合', () => {
    expect(isPuiBalanceConsistent(100, 90)).toBe(false);
    expect(isPuiBalanceConsistent(90, 100)).toBe(false);
  });
  it('残高がマイナスなら (一致していても) 不整合扱い', () => {
    expect(isPuiBalanceConsistent(-10, -10)).toBe(false);
  });
});
