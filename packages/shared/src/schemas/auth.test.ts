import { WithdrawAccountSchema, TotpVerifySchema, TotpDisableSchema, SignInSchema } from './auth';

describe('WithdrawAccountSchema', () => {
  it('パスワードが入力されていれば受理する', () => {
    const r = WithdrawAccountSchema.safeParse({ password: 'Secret123!' });
    expect(r.success).toBe(true);
  });

  it('パスワードが空文字なら拒否する', () => {
    const r = WithdrawAccountSchema.safeParse({ password: '' });
    expect(r.success).toBe(false);
  });

  it('パスワードが未指定なら拒否する', () => {
    const r = WithdrawAccountSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe('TotpVerifySchema', () => {
  it('6桁の数字コードを受理する', () => {
    const r = TotpVerifySchema.safeParse({ code: '123456' });
    expect(r.success).toBe(true);
  });

  it('桁数が違うコードは拒否する', () => {
    expect(TotpVerifySchema.safeParse({ code: '12345' }).success).toBe(false);
    expect(TotpVerifySchema.safeParse({ code: '1234567' }).success).toBe(false);
  });

  it('数字以外を含むコードは拒否する', () => {
    const r = TotpVerifySchema.safeParse({ code: 'abcdef' });
    expect(r.success).toBe(false);
  });

  it('未指定なら拒否する', () => {
    const r = TotpVerifySchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe('TotpDisableSchema', () => {
  it('パスワードが入力されていれば受理する', () => {
    const r = TotpDisableSchema.safeParse({ password: 'Secret123!' });
    expect(r.success).toBe(true);
  });

  it('パスワードが空文字なら拒否する', () => {
    const r = TotpDisableSchema.safeParse({ password: '' });
    expect(r.success).toBe(false);
  });
});

describe('SignInSchema (totpCode optional)', () => {
  it('totpCode 未指定でも受理する (一般ユーザーは不要なため)', () => {
    const r = SignInSchema.safeParse({ email: 'a@example.com', password: 'x' });
    expect(r.success).toBe(true);
  });

  it('totpCode を指定した場合も受理する (SUPER_ADMIN の2段階認証コード or バックアップコード)', () => {
    const r = SignInSchema.safeParse({
      email: 'a@example.com',
      password: 'x',
      totpCode: '123456',
    });
    expect(r.success).toBe(true);
  });
});
