import {
  renderBirthdayMailText,
  BirthdayMailTemplateSchema,
  BirthdayMailSendSchema,
} from './birthday-mail';

describe('renderBirthdayMailText', () => {
  it('replaces {name} with the recipient name', () => {
    expect(renderBirthdayMailText('{name}さん、おめでとう', { name: 'れい', year: 2026 })).toBe(
      'れいさん、おめでとう',
    );
  });

  it('replaces all occurrences of {name}', () => {
    expect(
      renderBirthdayMailText('{name}さん\n{name}さんへ', { name: '理江', year: 2026 }),
    ).toBe('理江さん\n理江さんへ');
  });

  it('replaces {year} with the year', () => {
    expect(renderBirthdayMailText('{year}年版', { name: 'x', year: 2027 })).toBe('2027年版');
  });

  it('leaves text without tokens unchanged', () => {
    expect(renderBirthdayMailText('お誕生日おめでとう', { name: 'x', year: 2026 })).toBe(
      'お誕生日おめでとう',
    );
  });
});

describe('BirthdayMailTemplateSchema', () => {
  it('accepts a valid template', () => {
    const r = BirthdayMailTemplateSchema.safeParse({
      year: 2026,
      subject: 'おめでとう',
      body: '本文',
      enabled: true,
    });
    expect(r.success).toBe(true);
  });

  it('defaults enabled to true', () => {
    const r = BirthdayMailTemplateSchema.parse({
      year: 2026,
      subject: 'おめでとう',
      body: '本文',
    });
    expect(r.enabled).toBe(true);
  });

  it('rejects an out-of-range year', () => {
    const r = BirthdayMailTemplateSchema.safeParse({
      year: 1999,
      subject: 'x',
      body: 'y',
    });
    expect(r.success).toBe(false);
  });

  it('rejects an empty subject', () => {
    const r = BirthdayMailTemplateSchema.safeParse({
      year: 2026,
      subject: '   ',
      body: 'y',
    });
    expect(r.success).toBe(false);
  });
});

describe('BirthdayMailSendSchema', () => {
  it('accepts year only (bulk send)', () => {
    const r = BirthdayMailSendSchema.safeParse({ year: 2026 });
    expect(r.success).toBe(true);
  });

  it('accepts year with userIds (individual send)', () => {
    const r = BirthdayMailSendSchema.safeParse({
      year: 2026,
      userIds: ['11111111-1111-4111-8111-111111111111'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects non-uuid userIds', () => {
    const r = BirthdayMailSendSchema.safeParse({ year: 2026, userIds: ['nope'] });
    expect(r.success).toBe(false);
  });
});
