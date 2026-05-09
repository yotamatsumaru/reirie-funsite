import { hashPassword, verifyPassword } from './password';

describe('password', () => {
  it('正しいパスワードで検証成功', () => {
    const hash = hashPassword('Secret123!');
    expect(verifyPassword('Secret123!', hash)).toBe(true);
  });
  it('違うパスワードで検証失敗', () => {
    const hash = hashPassword('Secret123!');
    expect(verifyPassword('Wrong123!', hash)).toBe(false);
  });
  it('null/不正形式を弾く', () => {
    expect(verifyPassword('Secret123!', null)).toBe(false);
    expect(verifyPassword('Secret123!', 'invalid-format')).toBe(false);
  });
  it('同じパスワードでもハッシュ毎に異なるsalt', () => {
    const a = hashPassword('Secret123!');
    const b = hashPassword('Secret123!');
    expect(a).not.toBe(b);
    expect(verifyPassword('Secret123!', a)).toBe(true);
    expect(verifyPassword('Secret123!', b)).toBe(true);
  });
});
