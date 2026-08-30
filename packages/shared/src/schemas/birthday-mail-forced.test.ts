/**
 * 誕生日メールの強制送信 (運営による救済操作) の判定ロジックのテスト。
 *
 * 強制送信は「日付もプランも無視して送る」強い操作なので、
 * 誤爆を防ぐガードが効いていることを重点的に固定する。
 */
import {
  BIRTHDAY_MAIL_FORCED_SEND_MAX,
  BirthdayMailSendSchema,
  describeBirthdayMailIneligibleReason,
  isValidForcedSendRequest,
  isWithinForcedSendLimit,
  type BirthdayMailIneligibleReason,
} from './birthday-mail';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

describe('isValidForcedSendRequest (強制送信の入力ガード)', () => {
  it('通常送信 (force なし) は userIds を省略できる（従来の一斉送信を壊さない）', () => {
    expect(isValidForcedSendRequest({})).toBe(true);
    expect(isValidForcedSendRequest({ force: false })).toBe(true);
    expect(isValidForcedSendRequest({ userIds: [] })).toBe(true);
  });

  it('強制送信で userIds を省略すると拒否する（全会員へ誤爆する事故を防ぐ）', () => {
    expect(isValidForcedSendRequest({ force: true })).toBe(false);
  });

  it('強制送信で userIds が空配列でも拒否する', () => {
    expect(isValidForcedSendRequest({ force: true, userIds: [] })).toBe(false);
  });

  it('強制送信で userIds が 1 件以上あれば許可する', () => {
    expect(isValidForcedSendRequest({ force: true, userIds: [UUID_A] })).toBe(true);
    expect(isValidForcedSendRequest({ force: true, userIds: [UUID_A, UUID_B] })).toBe(true);
  });
});

describe('isWithinForcedSendLimit (件数の上限)', () => {
  it('0 件は許可しない', () => {
    expect(isWithinForcedSendLimit([])).toBe(false);
  });

  it('1 件は許可する（救済は 1 名だけのことが多い）', () => {
    expect(isWithinForcedSendLimit([UUID_A])).toBe(true);
  });

  it('上限ちょうどは許可する', () => {
    const ids = Array.from({ length: BIRTHDAY_MAIL_FORCED_SEND_MAX }, () => UUID_A);
    expect(isWithinForcedSendLimit(ids)).toBe(true);
  });

  it('上限を 1 件でも超えたら拒否する（一斉送信の誤用を疑う）', () => {
    const ids = Array.from({ length: BIRTHDAY_MAIL_FORCED_SEND_MAX + 1 }, () => UUID_A);
    expect(isWithinForcedSendLimit(ids)).toBe(false);
  });
});

describe('BirthdayMailSendSchema (force フィールド)', () => {
  it('force を省略しても従来どおりパースできる（後方互換）', () => {
    const r = BirthdayMailSendSchema.safeParse({ year: 2026 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.force).toBeUndefined();
  });

  it('force=true と userIds を受け付ける', () => {
    const r = BirthdayMailSendSchema.safeParse({
      year: 2026,
      userIds: [UUID_A],
      force: true,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.force).toBe(true);
      expect(r.data.userIds).toEqual([UUID_A]);
    }
  });

  it('force が boolean 以外なら弾く', () => {
    const r = BirthdayMailSendSchema.safeParse({ year: 2026, force: 'yes' });
    expect(r.success).toBe(false);
  });

  it('userIds が UUID でなければ弾く', () => {
    const r = BirthdayMailSendSchema.safeParse({
      year: 2026,
      userIds: ['not-a-uuid'],
      force: true,
    });
    expect(r.success).toBe(false);
  });

  // スキーマ通過 + 業務ガードの二段構えになっていることの確認。
  // スキーマだけでは force+userIds省略 を弾けないので、
  // isValidForcedSendRequest が必要であることを明示する。
  it('スキーマは通るが業務ガードで弾かれるケースがある（二段構えの確認）', () => {
    const parsed = BirthdayMailSendSchema.safeParse({ year: 2026, force: true });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(isValidForcedSendRequest(parsed.data)).toBe(false);
    }
  });
});

describe('describeBirthdayMailIneligibleReason (対象外の理由表示)', () => {
  const ALL: BirthdayMailIneligibleReason[] = [
    'NO_BIRTHDATE',
    'NOT_PAID_PLAN',
    'NOT_TODAY',
    'ALREADY_SENT',
  ];

  it('すべての理由に日本語の説明がある（UI で空文字が出ない）', () => {
    for (const r of ALL) {
      const text = describeBirthdayMailIneligibleReason(r);
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('説明はそれぞれ異なる（理由の取り違えに気づけるように）', () => {
    const texts = ALL.map(describeBirthdayMailIneligibleReason);
    expect(new Set(texts).size).toBe(ALL.length);
  });

  it('送信済みの説明には「再送」であることが含まれる（運営が誤って二重送信しないため）', () => {
    expect(describeBirthdayMailIneligibleReason('ALREADY_SENT')).toContain('再送');
  });
});
