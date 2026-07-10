import { WithdrawAccountSchema } from './auth';

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
