/**
 * 会員カード & ポイント機能の共有ロジックの単体テスト
 */
import {
  formatMemberNumber,
  jstDateKey,
  previousJstDateKey,
  computeLoginBonusAmount,
  DEFAULT_POINT_RATES,
  PointRateSettingsSchema,
  SocialShareInputSchema,
  AdminAdjustPointsSchema,
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
  const rates = DEFAULT_POINT_RATES;
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

describe('DEFAULT_POINT_RATES', () => {
  it('ユーザー指定のデフォルト値', () => {
    expect(DEFAULT_POINT_RATES.loginBonusBase).toBe(10);
    expect(DEFAULT_POINT_RATES.loginStreakBonus).toBe(50);
    expect(DEFAULT_POINT_RATES.loginStreakThreshold).toBe(7);
    expect(DEFAULT_POINT_RATES.socialSharePoints).toBe(20);
  });
  it('スキーマでパース可能', () => {
    expect(PointRateSettingsSchema.safeParse(DEFAULT_POINT_RATES).success).toBe(true);
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

describe('AdminAdjustPointsSchema', () => {
  it('0 以外の増減を許可', () => {
    expect(
      AdminAdjustPointsSchema.safeParse({
        userId: '00000000-0000-0000-0000-000000000000',
        amount: 100,
      }).success,
    ).toBe(true);
  });
  it('0 は拒否', () => {
    expect(
      AdminAdjustPointsSchema.safeParse({
        userId: '00000000-0000-0000-0000-000000000000',
        amount: 0,
      }).success,
    ).toBe(false);
  });
});
