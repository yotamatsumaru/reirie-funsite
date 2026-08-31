import {
  RequestEmailChangeSchema,
  VerifyEmailChangeSchema,
  normalizeEmailForComparison,
  isSameEmail,
  isEmailChangePending,
  isEmailChangeResendCoolingDown,
  hasExceededEmailChangeAttempts,
  maskEmail,
  EMAIL_CHANGE_CODE_TTL_MINUTES,
  EMAIL_CHANGE_RESEND_COOLDOWN_SECONDS,
  MAX_EMAIL_CHANGE_ATTEMPTS,
} from './email-change';

describe('RequestEmailChangeSchema', () => {
  it('正しい入力を受け付ける', () => {
    const r = RequestEmailChangeSchema.safeParse({
      newEmail: 'kayonophoo@gmail.com',
      password: 'Test1234!',
    });
    expect(r.success).toBe(true);
  });

  it('メールアドレスの形式が不正なら拒否する', () => {
    const r = RequestEmailChangeSchema.safeParse({
      newEmail: 'not-an-email',
      password: 'Test1234!',
    });
    expect(r.success).toBe(false);
  });

  it('パスワード未入力は拒否する（本人確認を省略させない）', () => {
    const r = RequestEmailChangeSchema.safeParse({
      newEmail: 'kayonophoo@gmail.com',
      password: '',
    });
    expect(r.success).toBe(false);
  });

  it('パスワードが欠けている場合も拒否する', () => {
    const r = RequestEmailChangeSchema.safeParse({ newEmail: 'a@b.com' });
    expect(r.success).toBe(false);
  });
});

describe('VerifyEmailChangeSchema', () => {
  it('6桁の数字を受け付ける', () => {
    expect(VerifyEmailChangeSchema.safeParse({ code: '012345' }).success).toBe(true);
  });

  it('前後の空白は取り除いて判定する（コピペ対策）', () => {
    const r = VerifyEmailChangeSchema.safeParse({ code: '  123456  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.code).toBe('123456');
  });

  it('桁数が足りない/多い場合は拒否する', () => {
    expect(VerifyEmailChangeSchema.safeParse({ code: '12345' }).success).toBe(false);
    expect(VerifyEmailChangeSchema.safeParse({ code: '1234567' }).success).toBe(false);
  });

  it('数字以外を含む場合は拒否する', () => {
    expect(VerifyEmailChangeSchema.safeParse({ code: '12a456' }).success).toBe(false);
  });
});

describe('normalizeEmailForComparison / isSameEmail', () => {
  it('大文字小文字と前後空白を無視して正規化する', () => {
    expect(normalizeEmailForComparison('  KaYo@Example.COM ')).toBe('kayo@example.com');
  });

  it('大文字small差だけの場合は「同じアドレス」と判定する', () => {
    // DB の email は citext (大小区別なし) なので、アプリ側の判定も揃える必要がある。
    // ここがズレると「変更していないのに変更申請が通る」事故になる。
    expect(isSameEmail('Nopya106@docomo.ne.jp', 'nopya106@docomo.ne.jp')).toBe(true);
  });

  it('別のアドレスは異なると判定する', () => {
    expect(isSameEmail('nopya106@docomo.ne.jp', 'kayonophoo@gmail.com')).toBe(false);
  });
});

describe('isEmailChangePending', () => {
  const now = new Date('2026-08-30T12:00:00Z');

  it('保留アドレスがあり期限内なら「手続き中」', () => {
    expect(
      isEmailChangePending({
        pendingEmail: 'kayonophoo@gmail.com',
        expiresAt: new Date('2026-08-30T12:10:00Z'),
        now,
      }),
    ).toBe(true);
  });

  it('保留アドレスが無ければ「手続き中」ではない', () => {
    expect(
      isEmailChangePending({
        pendingEmail: null,
        expiresAt: new Date('2026-08-30T12:10:00Z'),
        now,
      }),
    ).toBe(false);
  });

  it('期限切れなら「手続き中」ではない（古い申請が残り続けない）', () => {
    expect(
      isEmailChangePending({
        pendingEmail: 'kayonophoo@gmail.com',
        expiresAt: new Date('2026-08-30T11:59:59Z'),
        now,
      }),
    ).toBe(false);
  });

  it('期限が未設定なら「手続き中」ではない', () => {
    expect(
      isEmailChangePending({ pendingEmail: 'kayonophoo@gmail.com', expiresAt: null, now }),
    ).toBe(false);
  });
});

describe('isEmailChangeResendCoolingDown', () => {
  const issued = new Date('2026-08-30T12:00:00Z');
  const expires = new Date(issued.getTime() + EMAIL_CHANGE_CODE_TTL_MINUTES * 60 * 1000);

  it('発行直後は再送できない（連打によるメール大量送信を防ぐ）', () => {
    expect(isEmailChangeResendCoolingDown({ expiresAt: expires, now: issued })).toBe(true);
  });

  it('クールダウン経過後は再送できる', () => {
    const after = new Date(issued.getTime() + (EMAIL_CHANGE_RESEND_COOLDOWN_SECONDS + 1) * 1000);
    expect(isEmailChangeResendCoolingDown({ expiresAt: expires, now: after })).toBe(false);
  });

  it('未申請 (期限なし) ならクールダウンしない', () => {
    expect(isEmailChangeResendCoolingDown({ expiresAt: null, now: issued })).toBe(false);
  });
});

describe('hasExceededEmailChangeAttempts', () => {
  it('上限未満では継続できる', () => {
    expect(hasExceededEmailChangeAttempts(MAX_EMAIL_CHANGE_ATTEMPTS - 1)).toBe(false);
  });

  it('上限に達したら打ち止め（総当たりを防ぐ）', () => {
    expect(hasExceededEmailChangeAttempts(MAX_EMAIL_CHANGE_ATTEMPTS)).toBe(true);
    expect(hasExceededEmailChangeAttempts(MAX_EMAIL_CHANGE_ATTEMPTS + 1)).toBe(true);
  });

  it('0 回は当然まだ継続できる', () => {
    expect(hasExceededEmailChangeAttempts(0)).toBe(false);
  });
});

describe('maskEmail', () => {
  it('ローカル部の先頭と末尾だけ残して伏せる', () => {
    expect(maskEmail('kayonophoo@gmail.com')).toBe('k********o@gmail.com');
  });

  it('伏字にしてもドメインは判別できる（本人が気づけるようにするため）', () => {
    expect(maskEmail('nopya106@docomo.ne.jp')).toContain('@docomo.ne.jp');
  });

  it('ローカル部が極端に短くても壊れない', () => {
    expect(maskEmail('ab@example.com')).toBe('a*@example.com');
    expect(maskEmail('a@example.com')).toBe('a*@example.com');
  });

  it('マスク結果に元のローカル部が丸ごと残らない', () => {
    const masked = maskEmail('kayonophoo@gmail.com');
    expect(masked).not.toContain('kayonophoo');
  });

  it('大文字で渡しても正規化してからマスクする', () => {
    expect(maskEmail('KAYONOPHOO@GMAIL.COM')).toBe('k********o@gmail.com');
  });
});
