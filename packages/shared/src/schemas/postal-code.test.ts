/**
 * PostalCodeSchema のテスト。
 *
 * 【背景】携帯 (docomo 等) の日本語キーボードは全角数字を入力しやすく、
 * 素の /^\d{3}-?\d{4}$/ では「１５７００６６」が弾かれて
 * 「郵便番号は7桁で入力してください」となり会員登録できなかった。
 * サーバ側でも正規化して受け付けることで、入口を問わず登録できるようにする。
 */
import { PostalCodeSchema } from './common';
import { SignUpSchema, UpdateProfileSchema } from './auth';
import { ShippingAddressSchema } from './ec';

describe('PostalCodeSchema', () => {
  it('半角7桁を 123-4567 形式に整形して受け付ける', () => {
    expect(PostalCodeSchema.parse('1570066')).toBe('157-0066');
  });

  it('ハイフン入りもそのまま受け付ける', () => {
    expect(PostalCodeSchema.parse('157-0066')).toBe('157-0066');
  });

  it('【回帰】全角数字を受け付ける (携帯の日本語入力対策)', () => {
    expect(PostalCodeSchema.parse('１５７００６６')).toBe('157-0066');
    expect(PostalCodeSchema.parse('１５７－００６６')).toBe('157-0066');
  });

  it('〒記号・スペース付きも受け付ける', () => {
    expect(PostalCodeSchema.parse('〒157-0066')).toBe('157-0066');
    expect(PostalCodeSchema.parse(' 157 0066 ')).toBe('157-0066');
  });

  it('先頭が 0 の郵便番号でも桁落ちしない', () => {
    expect(PostalCodeSchema.parse('0640941')).toBe('064-0941');
  });

  it('7桁でなければエラーになる', () => {
    expect(() => PostalCodeSchema.parse('157')).toThrow();
    expect(() => PostalCodeSchema.parse('15700661')).toThrow();
    expect(() => PostalCodeSchema.parse('')).toThrow();
    expect(() => PostalCodeSchema.parse('abcdefg')).toThrow();
  });

  it('エラーメッセージは日本語で分かりやすい', () => {
    const res = PostalCodeSchema.safeParse('157');
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.message).toBe('郵便番号は7桁で入力してください');
    }
  });
});

describe('各フォームのスキーマに反映されている', () => {
  const baseSignUp = {
    email: 'test@example.com',
    password: 'Password1',
    displayName: 'てすと',
    fullName: '山田 花子',
    phone: '090-1234-5678',
    birthDate: '1990-01-01',
    prefecture: '東京都',
    addressLine1: '世田谷区成城1-2-3',
  };

  it('【回帰】新規登録: 全角の郵便番号でも登録できる', () => {
    const res = SignUpSchema.safeParse({ ...baseSignUp, postalCode: '１５７００６６' });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.postalCode).toBe('157-0066');
  });

  it('新規登録: 桁数が足りない郵便番号は弾く', () => {
    const res = SignUpSchema.safeParse({ ...baseSignUp, postalCode: '157' });
    expect(res.success).toBe(false);
  });

  it('プロフィール更新: 全角でも受け付け、省略も可能', () => {
    const withZip = UpdateProfileSchema.safeParse({ postalCode: '〒１５７-００６６' });
    expect(withZip.success).toBe(true);
    if (withZip.success) expect(withZip.data.postalCode).toBe('157-0066');

    const without = UpdateProfileSchema.safeParse({ fullName: '山田 花子' });
    expect(without.success).toBe(true);
  });

  it('配送先住所 (EC): 全角でも受け付ける', () => {
    const res = ShippingAddressSchema.safeParse({
      name: '山田 花子',
      phone: '090-1234-5678',
      postalCode: '１５７００６６',
      prefecture: '東京都',
      addressLine1: '世田谷区成城1-2-3',
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.postalCode).toBe('157-0066');
  });
});
