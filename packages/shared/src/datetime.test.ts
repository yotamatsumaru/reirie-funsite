/**
 * JST 日時表示ユーティリティの単体テスト。
 *
 * 【重要】このテストが守りたいこと:
 *   サーバー (UTC) で実行しても、必ず日本時間 (JST = UTC+9) で整形されること。
 *   これが破れると「購入時刻が 9 時間ずれて表示される」バグが再発する。
 */
import { formatJstDateTime, formatJstDateTimeShort, formatJstDate } from './datetime';

describe('formatJstDateTime', () => {
  it('UTC の Date を JST (UTC+9) の日時に変換する', () => {
    // 2026-07-26T01:46:26Z (UTC) は JST では 2026/7/26 10:46:26
    const d = new Date('2026-07-26T01:46:26Z');
    const s = formatJstDateTime(d);
    expect(s).toContain('2026');
    expect(s).toContain('10:46:26');
  });

  it('日付をまたぐ深夜の UTC も JST では翌日になる', () => {
    // 2026-07-25T15:30:00Z (UTC) → JST 2026/7/26 0:30:00
    const s = formatJstDateTime(new Date('2026-07-25T15:30:00Z'));
    expect(s).toContain('2026');
    // 日本時間で 7/26 になっていること
    expect(s).toMatch(/7\/26/);
  });

  it('ISO 文字列・エポックミリ秒も受け付ける', () => {
    const iso = '2026-07-26T01:46:26Z';
    expect(formatJstDateTime(iso)).toBe(formatJstDateTime(new Date(iso)));
    expect(formatJstDateTime(Date.parse(iso))).toBe(formatJstDateTime(new Date(iso)));
  });

  it('無効な値は空文字を返す', () => {
    expect(formatJstDateTime(null)).toBe('');
    expect(formatJstDateTime(undefined)).toBe('');
    expect(formatJstDateTime('not-a-date')).toBe('');
  });
});

describe('formatJstDateTimeShort', () => {
  it('秒を含めない', () => {
    const s = formatJstDateTimeShort(new Date('2026-07-26T01:46:26Z'));
    expect(s).toContain('10:46');
    expect(s).not.toContain(':26');
  });
});

describe('formatJstDate', () => {
  it('JST の日付のみを返す', () => {
    const s = formatJstDate(new Date('2026-07-25T15:30:00Z'));
    expect(s).toMatch(/2026\/7\/26/);
  });

  it('無効な値は空文字', () => {
    expect(formatJstDate(null)).toBe('');
  });
});
