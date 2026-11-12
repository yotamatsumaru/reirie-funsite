jest.mock('@idol/db', () => ({ prisma: {} }));
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn() }));

import { B2_EXPORT_HEADER } from './yamato-b2';
import { b2ManagementNumber, buildNewsletterB2Csv } from './newsletter-b2';
import type { TargetUser } from './newsletter-mail';

const member = (over: Partial<TargetUser> = {}): TargetUser => ({
  id: '3f2c1d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
  email: 'taro@example.com',
  memberNumber: 'RR-000123',
  fullName: '山田 太郎',
  displayName: 'たろー',
  furigana: 'ヤマダ タロウ',
  postalCode: '1500001',
  prefecture: '東京都',
  addressLine1: '渋谷区神宮前1-1-1',
  addressLine2: 'マンション101',
  phone: '090-1234-5678',
  ...over,
});

/** BOM を除いて行 → 列に分解 (テストデータにカンマ・改行は含めない) */
function rowsOf(csv: string): string[][] {
  return csv
    .replace(/^\uFEFF/, '')
    .split('\n')
    .map((l) => l.split(','));
}

const opts = { itemName: '会報誌', invoiceType: '0' };

describe('buildNewsletterB2Csv', () => {
  it('EC の B2 CSV と同じヘッダで、BOM 付き', () => {
    const { csv } = buildNewsletterB2Csv([member()], opts);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(rowsOf(csv)[0]).toEqual(B2_EXPORT_HEADER);
  });

  it('会員番号・住所・氏名・電話・品名・個数を正しい列に入れる', () => {
    const { csv, exported } = buildNewsletterB2Csv([member()], opts);
    expect(exported).toBe(1);
    const row = rowsOf(csv)[1];
    const col = (name: string) => row[B2_EXPORT_HEADER.indexOf(name)];
    expect(col('お客様管理番号')).toBe('RR-000123');
    expect(col('送り状種類')).toBe('0');
    expect(col('クール区分')).toBe('0');
    expect(col('お届け先郵便番号')).toBe('150-0001');
    expect(col('お届け先住所')).toBe('東京都渋谷区神宮前1-1-1');
    expect(col('お届け先アパートマンション名')).toBe('マンション101');
    expect(col('お届け先名')).toBe('山田 太郎');
    expect(col('お届け先電話番号')).toBe('090-1234-5678');
    expect(col('品名１')).toBe('会報誌');
    expect(col('個数')).toBe('1');
  });

  it('送り状種類と品名は指定したものを使う (ネコポス等)', () => {
    const { csv } = buildNewsletterB2Csv([member()], {
      itemName: '会報誌 2026年 夏号',
      invoiceType: '7',
    });
    const row = rowsOf(csv)[1];
    expect(row[B2_EXPORT_HEADER.indexOf('送り状種類')]).toBe('7');
    expect(row[B2_EXPORT_HEADER.indexOf('品名１')]).toBe('会報誌 2026年 夏号');
  });

  it('本名が無ければ表示名を宛名にする', () => {
    const { csv } = buildNewsletterB2Csv([member({ fullName: null })], opts);
    expect(rowsOf(csv)[1][B2_EXPORT_HEADER.indexOf('お届け先名')]).toBe('たろー');
  });

  it('住所が揃っていない会員は含めず、件数だけ数える', () => {
    const r = buildNewsletterB2Csv(
      [member(), member({ id: 'b', memberNumber: 'RR-000124', postalCode: null })],
      opts,
    );
    expect(r.exported).toBe(1);
    expect(r.skippedNeedsInfo).toBe(1);
    expect(rowsOf(r.csv)).toHaveLength(2); // ヘッダ + 1 行
  });

  it('電話番号が無い会員は含めるが、件数を数えて警告できるようにする', () => {
    const r = buildNewsletterB2Csv([member({ phone: null }), member({ phone: '  ' })], opts);
    expect(r.exported).toBe(2);
    expect(r.missingPhone).toBe(2);
  });

  it('対象 0 件でもヘッダだけの CSV を返す', () => {
    const r = buildNewsletterB2Csv([], opts);
    expect(r.exported).toBe(0);
    expect(rowsOf(r.csv)).toEqual([B2_EXPORT_HEADER]);
  });
});

describe('b2ManagementNumber', () => {
  it('会員番号があればそれを使う', () => {
    expect(b2ManagementNumber({ id: 'x', memberNumber: 'RR-000001' })).toBe('RR-000001');
  });
  it('会員番号が無ければユーザー ID から作る (半角英数字のみ)', () => {
    const v = b2ManagementNumber({ id: '3f2c1d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f', memberNumber: null });
    expect(v).toBe('U-3f2c1d4e');
    expect(v).toMatch(/^[A-Za-z0-9-]+$/);
  });
});
