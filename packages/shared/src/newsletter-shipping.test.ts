import {
  MISSING_FIELD_LABELS,
  buildAddressReminderMail,
  buildShippingNoticeMail,
  formatPostalCode,
  fullAddress,
  isShippable,
  missingShippingFields,
  needsNameConfirmation,
  recipientName,
  summarizeRecipients,
  type ShippingProfile,
} from './newsletter-shipping';

const complete: ShippingProfile = {
  fullName: '山田 太郎',
  displayName: 'たろー',
  furigana: 'ヤマダ タロウ',
  postalCode: '1500001',
  prefecture: '東京都',
  addressLine1: '渋谷区神宮前1-1-1',
  addressLine2: 'マンション101',
};

describe('recipientName', () => {
  it('本名を優先する', () => {
    expect(recipientName(complete)).toBe('山田 太郎');
  });

  it('本名が無ければ表示名を使う', () => {
    expect(recipientName({ fullName: null, displayName: 'たろー' })).toBe('たろー');
  });

  it('空白のみは未入力として扱う', () => {
    expect(recipientName({ fullName: '   ', displayName: 'たろー' })).toBe('たろー');
    expect(recipientName({ fullName: '  ', displayName: '  ' })).toBe('');
  });

  it('どちらも無ければ空文字', () => {
    expect(recipientName({})).toBe('');
  });
});

describe('missingShippingFields', () => {
  it('すべて揃っていれば空', () => {
    expect(missingShippingFields(complete)).toEqual([]);
  });

  it('住所が全く無い場合はすべて挙げる', () => {
    expect(missingShippingFields({ displayName: 'たろー' })).toEqual([
      'postalCode',
      'prefecture',
      'addressLine1',
    ]);
  });

  it('氏名が無ければ name を含む', () => {
    expect(missingShippingFields({ ...complete, fullName: null, displayName: null })).toContain(
      'name',
    );
  });

  it('addressLine2 は必須ではない（マンション名なしでも届く）', () => {
    expect(missingShippingFields({ ...complete, addressLine2: null })).toEqual([]);
  });

  it('空白のみは未入力とみなす', () => {
    expect(missingShippingFields({ ...complete, postalCode: '   ' })).toEqual(['postalCode']);
  });

  it('すべての項目に日本語ラベルがある', () => {
    const all = missingShippingFields({});
    for (const f of all) {
      expect(MISSING_FIELD_LABELS[f]).toBeTruthy();
    }
  });
});

describe('isShippable', () => {
  it('必須が揃えば発送可能', () => {
    expect(isShippable(complete)).toBe(true);
  });
  it('1 つでも欠けたら不可', () => {
    expect(isShippable({ ...complete, addressLine1: null })).toBe(false);
    expect(isShippable({ ...complete, postalCode: '' })).toBe(false);
  });
  it('表示名だけでも住所が揃えば発送可能', () => {
    // 本名未登録でも «送れる» ので発送不能とは断定しない
    expect(isShippable({ ...complete, fullName: null })).toBe(true);
  });
});

describe('needsNameConfirmation', () => {
  it('本名が無く表示名のみなら確認推奨', () => {
    // 宛名が「ぴよぴよ」だと配達されない恐れがある
    expect(needsNameConfirmation({ ...complete, fullName: null })).toBe(true);
  });
  it('本名があれば確認不要', () => {
    expect(needsNameConfirmation(complete)).toBe(false);
  });
  it('どちらも無い場合は（そもそも発送不能なので）false', () => {
    expect(needsNameConfirmation({ fullName: null, displayName: null })).toBe(false);
  });
});

describe('formatPostalCode', () => {
  it('7 桁はハイフン区切りにする', () => {
    expect(formatPostalCode('1500001')).toBe('150-0001');
  });
  it('既にハイフン付きでも整形できる', () => {
    expect(formatPostalCode('150-0001')).toBe('150-0001');
  });
  it('7 桁でないものはそのまま返す', () => {
    expect(formatPostalCode('150')).toBe('150');
  });
  it('未入力は空文字', () => {
    expect(formatPostalCode(null)).toBe('');
    expect(formatPostalCode('  ')).toBe('');
  });
});

describe('fullAddress', () => {
  it('都道府県から順に連結する', () => {
    expect(fullAddress(complete)).toBe('東京都 渋谷区神宮前1-1-1 マンション101');
  });
  it('欠けている部分は詰めて連結する', () => {
    expect(fullAddress({ prefecture: '東京都', addressLine1: '渋谷区1-1' })).toBe(
      '東京都 渋谷区1-1',
    );
  });
  it('何も無ければ空文字', () => {
    expect(fullAddress({})).toBe('');
  });
});

describe('buildAddressReminderMail', () => {
  const mail = buildAddressReminderMail({
    name: '山田 太郎',
    missing: ['postalCode', 'prefecture', 'addressLine1'],
    issueLabel: '2026年 春号',
    profileUrl: 'https://example.com/me/profile',
    deadlineLabel: '3月5日',
    siteName: 'ReiRieRoom',
  });

  it('件名に号が入る', () => {
    expect(mail.subject).toContain('2026年 春号');
  });

  it('【最重要】足りない項目を名指しする', () => {
    // 「情報が不足しています」だけでは会員が何を直せばよいか分からない
    expect(mail.text).toContain('郵便番号');
    expect(mail.text).toContain('都道府県');
    expect(mail.text).toContain('住所');
  });

  it('直せるページの URL を含む', () => {
    expect(mail.text).toContain('https://example.com/me/profile');
  });

  it('締切を明示する', () => {
    expect(mail.text).toContain('3月5日');
  });

  it('宛名が入る', () => {
    expect(mail.text).toContain('山田 太郎 様');
  });

  it('行き違いへの配慮を入れる（登録済みの人に届いた場合）', () => {
    expect(mail.text).toContain('行き違い');
  });

  it('締切が無い場合も本文が壊れない', () => {
    const m = buildAddressReminderMail({
      name: '',
      missing: ['postalCode'],
      issueLabel: 'Vol.1',
      profileUrl: 'https://example.com/p',
      siteName: 'S',
    });
    expect(m.text).not.toContain('undefined');
    expect(m.text).toContain('プレミアム会員の皆さま'); // 宛名なしの代替
  });

  it('文面に undefined / null が混ざらない', () => {
    expect(mail.text).not.toMatch(/undefined|null/);
    expect(mail.subject).not.toMatch(/undefined|null/);
  });
});

describe('buildShippingNoticeMail', () => {
  const mail = buildShippingNoticeMail({
    name: '山田 太郎',
    issueLabel: '2026年 春号',
    shippedOnLabel: '2026年3月10日',
    arrivalLabel: '3〜5日程度',
    siteName: 'ReiRieRoom',
  });

  it('件名に「発送しました」と号が入る', () => {
    expect(mail.subject).toContain('発送');
    expect(mail.subject).toContain('2026年 春号');
  });

  it('発送日が入る', () => {
    expect(mail.text).toContain('2026年3月10日');
  });

  it('到着目安を書く（問い合わせを減らすため）', () => {
    expect(mail.text).toContain('3〜5日程度');
  });

  it('届かない場合の連絡先を案内する', () => {
    expect(mail.text).toContain('お問い合わせ');
  });

  it('補足メッセージを差し込める', () => {
    const m = buildShippingNoticeMail({
      name: 'A',
      issueLabel: 'V1',
      shippedOnLabel: '3月1日',
      siteName: 'S',
      note: '今号は特別付録つきです。',
    });
    expect(m.text).toContain('今号は特別付録つきです。');
  });

  it('任意項目が無くても文面が壊れない', () => {
    const m = buildShippingNoticeMail({
      name: '',
      issueLabel: 'V1',
      shippedOnLabel: '3月1日',
      siteName: 'S',
    });
    expect(m.text).not.toMatch(/undefined|null/);
  });
});

describe('summarizeRecipients', () => {
  it('発送可・要確認を集計する', () => {
    const s = summarizeRecipients([
      complete, // 発送可
      { ...complete, fullName: null }, // 発送可 + 宛名確認推奨
      { displayName: 'x' }, // 住所なし
      {}, // 全部なし
    ]);
    expect(s).toEqual({
      total: 4,
      shippable: 2,
      needsInfo: 2,
      needsNameCheck: 1,
    });
  });

  it('空配列でも落ちない', () => {
    expect(summarizeRecipients([])).toEqual({
      total: 0,
      shippable: 0,
      needsInfo: 0,
      needsNameCheck: 0,
    });
  });

  it('合計が矛盾しない', () => {
    const s = summarizeRecipients([complete, {}, { displayName: 'y' }]);
    expect(s.shippable + s.needsInfo).toBe(s.total);
  });
});
