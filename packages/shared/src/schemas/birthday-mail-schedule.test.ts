import {
  BIRTHDAY_MAIL_SCHEDULE_KEY,
  BIRTHDAY_MAIL_RUN_STATE_KEY,
  BIRTHDAY_MAIL_MINUTE_STEP,
  DEFAULT_BIRTHDAY_MAIL_SCHEDULE,
  DEFAULT_BIRTHDAY_MAIL_RUN_STATE,
  BirthdayMailScheduleSchema,
  BirthdayMailScheduleUpdateSchema,
  BirthdayMailRunStateSchema,
  formatBirthdayMailTime,
  formatBirthdayMailDate,
  birthdayMailTimeToMinutes,
  isBirthdayMailScheduleDue,
} from './birthday-mail';

describe('DEFAULT_BIRTHDAY_MAIL_SCHEDULE', () => {
  // 【要件】「今はお昼の12時に送れるようにしてほしい」= 既定は 12:00 JST。
  it('既定の送信時刻はお昼の12:00である', () => {
    expect(DEFAULT_BIRTHDAY_MAIL_SCHEDULE.hour).toBe(12);
    expect(DEFAULT_BIRTHDAY_MAIL_SCHEDULE.minute).toBe(0);
  });

  it('既定で自動送信は有効である（設定しなくても自動で送られる）', () => {
    expect(DEFAULT_BIRTHDAY_MAIL_SCHEDULE.enabled).toBe(true);
  });

  it('既定値はスキーマを通る', () => {
    const r = BirthdayMailScheduleSchema.safeParse(DEFAULT_BIRTHDAY_MAIL_SCHEDULE);
    expect(r.success).toBe(true);
  });

  it('分の刻みは 60 を割り切る（セレクタが 60 分を跨がない）', () => {
    expect(60 % BIRTHDAY_MAIL_MINUTE_STEP).toBe(0);
    expect(DEFAULT_BIRTHDAY_MAIL_SCHEDULE.minute % BIRTHDAY_MAIL_MINUTE_STEP).toBe(0);
  });
});

describe('設定キー', () => {
  it('スケジュールと実行状況は別キーに保存される', () => {
    expect(BIRTHDAY_MAIL_SCHEDULE_KEY).toBe('birthdayMail.schedule');
    expect(BIRTHDAY_MAIL_RUN_STATE_KEY).toBe('birthdayMail.runState');
    expect(BIRTHDAY_MAIL_SCHEDULE_KEY).not.toBe(BIRTHDAY_MAIL_RUN_STATE_KEY);
  });
});

describe('BirthdayMailScheduleSchema', () => {
  it('正常な設定を受け付ける', () => {
    const r = BirthdayMailScheduleSchema.safeParse({ enabled: true, hour: 9, minute: 30 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ enabled: true, hour: 9, minute: 30 });
  });

  it('空オブジェクトには既定値（12:00・有効）が入る', () => {
    const r = BirthdayMailScheduleSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual({ enabled: true, hour: 12, minute: 0 });
  });

  it('0時0分（真夜中）を受け付ける', () => {
    expect(BirthdayMailScheduleSchema.safeParse({ hour: 0, minute: 0 }).success).toBe(true);
  });

  it('23時59分を受け付ける', () => {
    expect(BirthdayMailScheduleSchema.safeParse({ hour: 23, minute: 59 }).success).toBe(true);
  });

  it('24時は拒否する', () => {
    expect(BirthdayMailScheduleSchema.safeParse({ hour: 24, minute: 0 }).success).toBe(false);
  });

  it('負の時刻は拒否する', () => {
    expect(BirthdayMailScheduleSchema.safeParse({ hour: -1, minute: 0 }).success).toBe(false);
    expect(BirthdayMailScheduleSchema.safeParse({ hour: 12, minute: -5 }).success).toBe(false);
  });

  it('60分は拒否する', () => {
    expect(BirthdayMailScheduleSchema.safeParse({ hour: 12, minute: 60 }).success).toBe(false);
  });

  it('小数の時刻は拒否する', () => {
    expect(BirthdayMailScheduleSchema.safeParse({ hour: 12.5, minute: 0 }).success).toBe(false);
  });

  it('enabled=false を受け付ける（自動送信の停止）', () => {
    const r = BirthdayMailScheduleSchema.safeParse({ enabled: false, hour: 12, minute: 0 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.enabled).toBe(false);
  });

  it('未知のフィールドは無視される（旧バージョンの保存値でも壊れない）', () => {
    const r = BirthdayMailScheduleSchema.safeParse({
      enabled: true,
      hour: 12,
      minute: 0,
      legacyField: 'x',
    });
    expect(r.success).toBe(true);
  });
});

describe('BirthdayMailScheduleUpdateSchema', () => {
  it('時だけの部分更新を受け付ける', () => {
    const r = BirthdayMailScheduleUpdateSchema.safeParse({ hour: 18 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.hour).toBe(18);
      // 【重要】指定していない項目は undefined のまま = 既定値で上書きしない。
      expect(r.data.minute).toBeUndefined();
      expect(r.data.enabled).toBeUndefined();
    }
  });

  it('分だけの部分更新を受け付ける', () => {
    const r = BirthdayMailScheduleUpdateSchema.safeParse({ minute: 45 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.hour).toBeUndefined();
  });

  it('enabled だけの部分更新を受け付ける', () => {
    const r = BirthdayMailScheduleUpdateSchema.safeParse({ enabled: false });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.enabled).toBe(false);
  });

  it('空の更新は拒否する（無意味なリクエスト）', () => {
    expect(BirthdayMailScheduleUpdateSchema.safeParse({}).success).toBe(false);
  });

  it('範囲外の値は部分更新でも拒否する', () => {
    expect(BirthdayMailScheduleUpdateSchema.safeParse({ hour: 99 }).success).toBe(false);
    expect(BirthdayMailScheduleUpdateSchema.safeParse({ minute: 61 }).success).toBe(false);
  });
});

describe('birthdayMailTimeToMinutes', () => {
  it('0:00 は 0 分', () => {
    expect(birthdayMailTimeToMinutes({ hour: 0, minute: 0 })).toBe(0);
  });

  it('12:00 は 720 分', () => {
    expect(birthdayMailTimeToMinutes({ hour: 12, minute: 0 })).toBe(720);
  });

  it('23:59 は 1439 分', () => {
    expect(birthdayMailTimeToMinutes({ hour: 23, minute: 59 })).toBe(1439);
  });
});

describe('isBirthdayMailScheduleDue', () => {
  const noon = { hour: 12, minute: 0 };

  it('11:59 はまだ送信しない', () => {
    expect(isBirthdayMailScheduleDue(noon, { hour: 11, minute: 59 })).toBe(false);
  });

  it('12:00 ちょうどで送信する', () => {
    expect(isBirthdayMailScheduleDue(noon, { hour: 12, minute: 0 })).toBe(true);
  });

  // 【最重要】cron は 5 分おきなので 12:00 ちょうどに叩かれる保証がない。
  // 「以上」判定でないと、遅れた日はその日ずっと送信されなくなる。
  it('12:03 でも送信する（cron が数分遅れても取りこぼさない）', () => {
    expect(isBirthdayMailScheduleDue(noon, { hour: 12, minute: 3 })).toBe(true);
  });

  it('23:55 でも送信する（デプロイ等で大きく遅れてもその日のうちに届く）', () => {
    expect(isBirthdayMailScheduleDue(noon, { hour: 23, minute: 55 })).toBe(true);
  });

  it('0:00 に設定すれば一日中 due（真夜中設定でも動く）', () => {
    expect(isBirthdayMailScheduleDue({ hour: 0, minute: 0 }, { hour: 0, minute: 0 })).toBe(true);
    expect(isBirthdayMailScheduleDue({ hour: 0, minute: 0 }, { hour: 23, minute: 59 })).toBe(true);
  });

  it('23:59 設定なら 23:58 は未到達', () => {
    expect(isBirthdayMailScheduleDue({ hour: 23, minute: 59 }, { hour: 23, minute: 58 })).toBe(
      false,
    );
  });

  it('分の比較が時をまたいで正しい（09:30 設定に 10:00 は due）', () => {
    expect(isBirthdayMailScheduleDue({ hour: 9, minute: 30 }, { hour: 10, minute: 0 })).toBe(true);
    expect(isBirthdayMailScheduleDue({ hour: 9, minute: 30 }, { hour: 9, minute: 29 })).toBe(false);
  });
});

describe('formatBirthdayMailTime', () => {
  it('ゼロ埋めした HH:MM を返す', () => {
    expect(formatBirthdayMailTime({ hour: 12, minute: 0 })).toBe('12:00');
    expect(formatBirthdayMailTime({ hour: 9, minute: 5 })).toBe('09:05');
    expect(formatBirthdayMailTime({ hour: 0, minute: 0 })).toBe('00:00');
    expect(formatBirthdayMailTime({ hour: 23, minute: 59 })).toBe('23:59');
  });

  it('既定値は「12:00」と表示される', () => {
    expect(formatBirthdayMailTime(DEFAULT_BIRTHDAY_MAIL_SCHEDULE)).toBe('12:00');
  });
});

describe('formatBirthdayMailDate', () => {
  it('ゼロ埋めした YYYY-MM-DD を返す', () => {
    expect(formatBirthdayMailDate({ year: 2026, month: 8, day: 8 })).toBe('2026-08-08');
    expect(formatBirthdayMailDate({ year: 2026, month: 12, day: 31 })).toBe('2026-12-31');
    expect(formatBirthdayMailDate({ year: 2026, month: 1, day: 1 })).toBe('2026-01-01');
  });

  // 日付キーは「その日ぶんを実行済みか」の判定に使うので、
  // 同じ日が必ず同じ文字列になる（= 2026-8-8 と 2026-08-08 が混ざらない）ことが重要。
  it('同じ日付は必ず同じキーになる', () => {
    const a = formatBirthdayMailDate({ year: 2026, month: 8, day: 8 });
    const b = formatBirthdayMailDate({ year: 2026, month: 8, day: 8 });
    expect(a).toBe(b);
  });

  it('異なる日付は異なるキーになる', () => {
    const a = formatBirthdayMailDate({ year: 2026, month: 1, day: 12 });
    const b = formatBirthdayMailDate({ year: 2026, month: 12, day: 1 });
    expect(a).not.toBe(b);
  });
});

describe('BirthdayMailRunStateSchema', () => {
  it('既定値はスキーマを通る', () => {
    expect(BirthdayMailRunStateSchema.safeParse(DEFAULT_BIRTHDAY_MAIL_RUN_STATE).success).toBe(
      true,
    );
  });

  it('未実行状態（全て null）を受け付ける', () => {
    const r = BirthdayMailRunStateSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.lastRunDate).toBeNull();
  });

  it('実行済み状態を受け付ける', () => {
    const r = BirthdayMailRunStateSchema.safeParse({
      lastRunDate: '2026-08-08',
      lastRunAt: '2026-08-08T03:00:00.000Z',
      lastStatus: 'sent',
      lastSent: 3,
      lastFailed: 0,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.lastSent).toBe(3);
  });

  it('破損した型は拒否する（getter 側で既定値にフォールバックさせる）', () => {
    expect(BirthdayMailRunStateSchema.safeParse({ lastSent: 'many' }).success).toBe(false);
  });
});
