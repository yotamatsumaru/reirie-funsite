import {
  CONTACT_TICKET_ALPHABET,
  CONTACT_TICKET_PREFIX,
  CONTACT_TICKET_RANDOM_LENGTH,
  CONTACT_ADMIN_EMAIL_MAX,
  DEFAULT_CONTACT_NOTIFICATION_SETTINGS,
  ContactNotificationSettingsSchema,
  adminRecipientsExcludingSender,
  buildContactEchoBlock,
  formatContactReceivedAt,
  formatContactTicketNumber,
  generateContactTicketNumber,
  isValidContactTicketNumber,
  normalizeAdminEmails,
  parseAdminEmailsText,
  shouldNotifyAdmins,
  stringifyAdminEmails,
  toJstDateKey,
} from './contact-ack';

describe('toJstDateKey', () => {
  it('JST の YYYYMMDD を返す', () => {
    expect(toJstDateKey(new Date('2026-09-02T03:00:00Z'))).toBe('20260902');
  });

  it('UTC では前日になる時刻でも JST の日付になる (朝 8 時 JST)', () => {
    // 2026-09-01T23:00Z = 2026-09-02 08:00 JST
    expect(toJstDateKey(new Date('2026-09-01T23:00:00Z'))).toBe('20260902');
  });

  it('JST の 0 時直前 (UTC 14:59) は当日扱い', () => {
    // 2026-09-02T14:59Z = 2026-09-02 23:59 JST
    expect(toJstDateKey(new Date('2026-09-02T14:59:00Z'))).toBe('20260902');
  });

  it('JST の 0 時 (UTC 15:00) で翌日に繰り上がる', () => {
    // 2026-09-02T15:00Z = 2026-09-03 00:00 JST
    expect(toJstDateKey(new Date('2026-09-02T15:00:00Z'))).toBe('20260903');
  });
});

describe('generateContactTicketNumber', () => {
  it('CT-YYYYMMDD-XXXXX 形式を返す', () => {
    const n = generateContactTicketNumber(new Date('2026-09-02T03:00:00Z'), () => 0);
    expect(n).toBe(`${CONTACT_TICKET_PREFIX}-20260902-22222`);
    expect(isValidContactTicketNumber(n)).toBe(true);
  });

  it('ランダム部の長さが定数どおり', () => {
    const n = generateContactTicketNumber(new Date(), () => 0.5);
    const random = n.split('-')[2] ?? '';
    expect(random).toHaveLength(CONTACT_TICKET_RANDOM_LENGTH);
  });

  it('紛らわしい文字 (O/0/I/1/L) を含まない', () => {
    // 全 32 通りの文字が出るよう乱数を走査する
    for (let i = 0; i < CONTACT_TICKET_ALPHABET.length; i += 1) {
      const ratio = i / CONTACT_TICKET_ALPHABET.length;
      const n = generateContactTicketNumber(new Date(), () => ratio);
      const random = n.split('-')[2] ?? '';
      expect(random).not.toMatch(/[O0IL1]/);
    }
  });

  it('randomFn が 1 を返しても範囲外文字にならない (clamp)', () => {
    const n = generateContactTicketNumber(new Date('2026-09-02T03:00:00Z'), () => 1);
    expect(isValidContactTicketNumber(n)).toBe(true);
  });

  it('randomFn が NaN を返しても妥当な番号になる', () => {
    const n = generateContactTicketNumber(new Date('2026-09-02T03:00:00Z'), () => Number.NaN);
    expect(isValidContactTicketNumber(n)).toBe(true);
  });

  it('連続生成でほぼ重複しない (1000 回で重複なし)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i += 1) set.add(generateContactTicketNumber());
    expect(set.size).toBe(1000);
  });
});

describe('isValidContactTicketNumber', () => {
  it('正しい番号を受け入れる', () => {
    expect(isValidContactTicketNumber('CT-20260902-7K3QF')).toBe(true);
  });

  it('null / 空文字 / undefined を拒否する', () => {
    expect(isValidContactTicketNumber(null)).toBe(false);
    expect(isValidContactTicketNumber(undefined)).toBe(false);
    expect(isValidContactTicketNumber('')).toBe(false);
  });

  it('接頭辞が違うものを拒否する', () => {
    expect(isValidContactTicketNumber('XX-20260902-7K3QF')).toBe(false);
  });

  it('除外文字 (O / 0 / I / L) を含むものを拒否する', () => {
    expect(isValidContactTicketNumber('CT-20260902-7K3Q0')).toBe(false);
    expect(isValidContactTicketNumber('CT-20260902-7K3QO')).toBe(false);
    expect(isValidContactTicketNumber('CT-20260902-7K3QI')).toBe(false);
    expect(isValidContactTicketNumber('CT-20260902-7K3QL')).toBe(false);
  });

  it('小文字を拒否する (表記ゆれを許さない)', () => {
    expect(isValidContactTicketNumber('ct-20260902-7k3qf')).toBe(false);
  });

  it('桁数違いを拒否する', () => {
    expect(isValidContactTicketNumber('CT-2026902-7K3QF')).toBe(false);
    expect(isValidContactTicketNumber('CT-20260902-7K3Q')).toBe(false);
    expect(isValidContactTicketNumber('CT-20260902-7K3QFA')).toBe(false);
  });
});

describe('formatContactTicketNumber', () => {
  it('妥当な番号はそのまま返す', () => {
    expect(formatContactTicketNumber('CT-20260902-7K3QF')).toBe('CT-20260902-7K3QF');
  });

  it('未採番 (null) はダッシュを返す (管理画面に null を出さない)', () => {
    expect(formatContactTicketNumber(null)).toBe('—');
    expect(formatContactTicketNumber('')).toBe('—');
  });
});

describe('formatContactReceivedAt', () => {
  it('JST で整形する', () => {
    const label = formatContactReceivedAt(new Date('2026-09-02T03:04:00Z'));
    // 2026-09-02T03:04Z = 12:04 JST
    expect(label).toContain('2026');
    expect(label).toContain('12:04');
  });

  it('深夜 0 時台が 24 時表記にならない (hourCycle h23)', () => {
    // 2026-09-01T15:30Z = 2026-09-02 00:30 JST
    const label = formatContactReceivedAt(new Date('2026-09-01T15:30:00Z'));
    expect(label).toContain('00:30');
    expect(label).not.toContain('24:30');
  });
});

describe('buildContactEchoBlock', () => {
  const base = {
    ticketNumber: 'CT-20260902-7K3QF',
    categoryLabel: '不具合の報告',
    subject: 'ログインできません',
    message: '一行目\n二行目',
    name: '山田 花子',
    email: 'hanako@example.com',
    receivedAtLabel: '2026/09/02 12:04',
  };

  it('受付番号・件名・本文を含む', () => {
    const s = buildContactEchoBlock(base);
    expect(s).toContain('CT-20260902-7K3QF');
    expect(s).toContain('ログインできません');
    expect(s).toContain('一行目\n二行目');
    expect(s).toContain('不具合の報告');
  });

  it('本文の改行を保持する (送信内容をそのまま引用する要望のため)', () => {
    const s = buildContactEchoBlock({ ...base, message: 'a\n\nb' });
    expect(s).toContain('a\n\nb');
  });

  it('本文を改変しない (前後の空白も含めて原文を引用)', () => {
    const s = buildContactEchoBlock({ ...base, message: '  spaced  ' });
    expect(s).toContain('  spaced  ');
  });
});

describe('normalizeAdminEmails', () => {
  it('トリム・小文字化する', () => {
    expect(normalizeAdminEmails([' Admin@Example.com '])).toEqual(['admin@example.com']);
  });

  it('重複を除去する (同じ宛先へ 2 通届く事故を防ぐ)', () => {
    expect(normalizeAdminEmails(['a@example.com', 'A@example.com'])).toEqual(['a@example.com']);
  });

  it('空要素を除去する', () => {
    expect(normalizeAdminEmails(['', '  ', 'a@example.com'])).toEqual(['a@example.com']);
  });

  it('入力順を保持する', () => {
    expect(normalizeAdminEmails(['b@example.com', 'a@example.com'])).toEqual([
      'b@example.com',
      'a@example.com',
    ]);
  });
});

describe('parseAdminEmailsText', () => {
  it('改行区切りをパースする', () => {
    expect(parseAdminEmailsText('a@example.com\nb@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });

  it('カンマ / セミコロン区切りもパースする', () => {
    expect(parseAdminEmailsText('a@example.com, b@example.com; c@example.com')).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com',
    ]);
  });

  it('空文字は空配列', () => {
    expect(parseAdminEmailsText('')).toEqual([]);
    expect(parseAdminEmailsText('\n\n  \n')).toEqual([]);
  });

  it('stringifyAdminEmails と往復する', () => {
    const list = ['a@example.com', 'b@example.com'];
    expect(parseAdminEmailsText(stringifyAdminEmails(list))).toEqual(list);
  });
});

describe('ContactNotificationSettingsSchema', () => {
  it('空オブジェクトから既定値を組み立てる', () => {
    const parsed = ContactNotificationSettingsSchema.parse({});
    expect(parsed).toEqual(DEFAULT_CONTACT_NOTIFICATION_SETTINGS);
  });

  it('控えメールは既定で有効 (会員のご要望そのものなので)', () => {
    expect(DEFAULT_CONTACT_NOTIFICATION_SETTINGS.ackMailEnabled).toBe(true);
  });

  it('運営通知の宛先は既定で空 (誤送信防止)', () => {
    expect(DEFAULT_CONTACT_NOTIFICATION_SETTINGS.adminEmails).toEqual([]);
  });

  it('不正なメールアドレスを拒否する', () => {
    const r = ContactNotificationSettingsSchema.safeParse({ adminEmails: ['not-an-email'] });
    expect(r.success).toBe(false);
  });

  it('宛先の上限を超えると拒否する', () => {
    const many = Array.from({ length: CONTACT_ADMIN_EMAIL_MAX + 1 }, (_, i) => `a${i}@example.com`);
    const r = ContactNotificationSettingsSchema.safeParse({ adminEmails: many });
    expect(r.success).toBe(false);
  });

  it('上限ちょうどは許可する', () => {
    const many = Array.from({ length: CONTACT_ADMIN_EMAIL_MAX }, (_, i) => `a${i}@example.com`);
    const r = ContactNotificationSettingsSchema.safeParse({ adminEmails: many });
    expect(r.success).toBe(true);
  });
});

describe('shouldNotifyAdmins', () => {
  it('有効かつ宛先ありなら true', () => {
    const s = ContactNotificationSettingsSchema.parse({ adminEmails: ['a@example.com'] });
    expect(shouldNotifyAdmins(s)).toBe(true);
  });

  it('ON でも宛先が空なら false (よくある設定ミスをここで吸収)', () => {
    const s = ContactNotificationSettingsSchema.parse({ adminNotifyEnabled: true });
    expect(shouldNotifyAdmins(s)).toBe(false);
  });

  it('OFF なら宛先があっても false', () => {
    const s = ContactNotificationSettingsSchema.parse({
      adminNotifyEnabled: false,
      adminEmails: ['a@example.com'],
    });
    expect(shouldNotifyAdmins(s)).toBe(false);
  });
});

describe('adminRecipientsExcludingSender', () => {
  const settings = ContactNotificationSettingsSchema.parse({
    adminEmails: ['staff@example.com', 'boss@example.com'],
  });

  it('送信者と重複する宛先を除外する (同じ受信箱に 2 通届くのを防ぐ)', () => {
    expect(adminRecipientsExcludingSender(settings, 'staff@example.com')).toEqual([
      'boss@example.com',
    ]);
  });

  it('大文字小文字を無視して除外する', () => {
    expect(adminRecipientsExcludingSender(settings, ' STAFF@Example.com ')).toEqual([
      'boss@example.com',
    ]);
  });

  it('無関係な送信者ならすべて残る', () => {
    expect(adminRecipientsExcludingSender(settings, 'member@example.com')).toEqual([
      'staff@example.com',
      'boss@example.com',
    ]);
  });
});
