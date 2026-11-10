import { hasValidCronSecret, safeEqualSecret } from './secret-compare';

describe('safeEqualSecret', () => {
  it('一致するときだけ true', () => {
    expect(safeEqualSecret('abc123', 'abc123')).toBe(true);
    expect(safeEqualSecret('abc124', 'abc123')).toBe(false);
    expect(safeEqualSecret('abc', 'abc123')).toBe(false); // 長さ違いでも例外にならない
  });
  it('未設定・空文字は常に false (CRON_SECRET 未設定で素通りしない)', () => {
    expect(safeEqualSecret('', '')).toBe(false);
    expect(safeEqualSecret(null, 'x')).toBe(false);
    expect(safeEqualSecret('x', undefined)).toBe(false);
    expect(safeEqualSecret(undefined, undefined)).toBe(false);
  });
});

describe('hasValidCronSecret', () => {
  const req = (h?: string) =>
    new Request('http://localhost/api/x', { headers: h ? { 'x-cron-secret': h } : {} });
  it('ヘッダが一致すれば true', () => {
    expect(hasValidCronSecret(req('s3cret'), 's3cret')).toBe(true);
    expect(hasValidCronSecret(req('wrong'), 's3cret')).toBe(false);
    expect(hasValidCronSecret(req(), 's3cret')).toBe(false);
  });
});
