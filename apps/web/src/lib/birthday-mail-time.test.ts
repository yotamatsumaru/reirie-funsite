/**
 * jstNowTime() の回帰テスト。
 *
 * 【なぜ重要か】本番サーバー (EC2) は UTC で稼働しているため、
 * new Date().getHours() を使うと日本時間より 9 時間ずれる。
 * 「12:00 に送る」設定が UTC 12:00 = JST 21:00 に送られてしまう事故を防ぐ。
 */
import { jstNowTime, jstToday } from './birthday-mail';

/** システム時刻を固定して jstNowTime() を評価する。 */
function atUtc(iso: string): { hour: number; minute: number } {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(iso));
  try {
    return jstNowTime();
  } finally {
    jest.useRealTimers();
  }
}

function dateAtUtc(iso: string): { year: number; month: number; day: number } {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(iso));
  try {
    return jstToday();
  } finally {
    jest.useRealTimers();
  }
}

describe('jstNowTime', () => {
  it('UTC 03:00 は JST 12:00 (お昼) になる', () => {
    // 【要件の核心】既定の送信時刻 12:00 JST は UTC 03:00 に対応する。
    expect(atUtc('2026-08-08T03:00:00Z')).toEqual({ hour: 12, minute: 0 });
  });

  it('UTC 02:59 は JST 11:59 (まだ送信しない時刻)', () => {
    expect(atUtc('2026-08-08T02:59:00Z')).toEqual({ hour: 11, minute: 59 });
  });

  it('UTC 12:00 は JST 21:00 (サーバー時刻をそのまま使うと事故る値)', () => {
    const t = atUtc('2026-08-08T12:00:00Z');
    expect(t).toEqual({ hour: 21, minute: 0 });
    // 【回帰】UTC の 12 をそのまま返していないことを明示的に確認する。
    expect(t.hour).not.toBe(12);
  });

  it('UTC 15:00 は翌日 JST 00:00 — 24 ではなく 0 を返す', () => {
    // hourCycle: 'h23' を指定しないと環境によって "24" になり、
    // 時刻比較 (0〜23 前提) が壊れる。
    const t = atUtc('2026-08-08T15:00:00Z');
    expect(t.hour).toBe(0);
    expect(t.hour).toBeLessThan(24);
  });

  it('UTC 14:59 は JST 23:59', () => {
    expect(atUtc('2026-08-08T14:59:00Z')).toEqual({ hour: 23, minute: 59 });
  });

  it('UTC 15:01 は JST 00:01', () => {
    expect(atUtc('2026-08-08T15:01:00Z')).toEqual({ hour: 0, minute: 1 });
  });

  it('分がゼロ埋め表記でも数値として正しく取れる (JST 12:05)', () => {
    expect(atUtc('2026-08-08T03:05:00Z')).toEqual({ hour: 12, minute: 5 });
  });

  it('常に 0〜23 時 / 0〜59 分の範囲を返す (24時間ぶんを走査)', () => {
    for (let h = 0; h < 24; h++) {
      const t = atUtc(`2026-08-08T${String(h).padStart(2, '0')}:30:00Z`);
      expect(t.hour).toBeGreaterThanOrEqual(0);
      expect(t.hour).toBeLessThanOrEqual(23);
      expect(t.minute).toBe(30);
    }
  });

  it('日本には夏時間が無いため、夏 (8月) と冬 (1月) で同じオフセット', () => {
    expect(atUtc('2026-08-08T03:00:00Z')).toEqual({ hour: 12, minute: 0 });
    expect(atUtc('2026-01-08T03:00:00Z')).toEqual({ hour: 12, minute: 0 });
  });
});

describe('jstToday と jstNowTime の整合', () => {
  it('UTC 15:00 (JST 翌日 0:00) では日付も翌日になる', () => {
    // 日付だけ進んで時刻が 24 のまま、といった不整合が無いことを確認する。
    expect(dateAtUtc('2026-08-08T15:00:00Z')).toEqual({ year: 2026, month: 8, day: 9 });
    expect(atUtc('2026-08-08T15:00:00Z').hour).toBe(0);
  });

  it('UTC 14:59 (JST 同日 23:59) では日付は当日のまま', () => {
    expect(dateAtUtc('2026-08-08T14:59:00Z')).toEqual({ year: 2026, month: 8, day: 8 });
    expect(atUtc('2026-08-08T14:59:00Z').hour).toBe(23);
  });

  it('年をまたぐ境界でも整合する (UTC 12/31 15:00 → JST 1/1 0:00)', () => {
    expect(dateAtUtc('2026-12-31T15:00:00Z')).toEqual({ year: 2027, month: 1, day: 1 });
    expect(atUtc('2026-12-31T15:00:00Z')).toEqual({ hour: 0, minute: 0 });
  });
});
