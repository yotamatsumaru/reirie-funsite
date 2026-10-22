/**
 * スロットの見た目テーマ (通常 / ハロウィン) の単体テスト。
 *
 * 重点:
 *  1. 期間判定が JST 基準であること (UTC のまま判定すると 10/1 の朝 9 時まで通常になる等)
 *  2. 全テーマで全絵柄・全役の表示が定義されていること (欠けると UI に undefined が出る)
 *  3. 同じテーマ内で絵柄の見た目が重複しないこと (3 つ揃いが判別できなくなる)
 */
import {
  SLOT_SYMBOLS,
  SLOT_WINNING_OUTCOMES,
  SLOT_THEMES,
  SLOT_THEME_MODES,
  SLOT_THEME_DEFINITIONS,
  isHalloweenSeason,
  resolveSlotTheme,
  parseSlotThemeMode,
  DEFAULT_SLOT_THEME_MODE,
} from './index';

describe('isHalloweenSeason (JST)', () => {
  it('JST 10/1 00:00 から開始 (UTC 9/30 15:00)', () => {
    expect(isHalloweenSeason(new Date('2026-09-30T14:59:59Z'))).toBe(false);
    expect(isHalloweenSeason(new Date('2026-09-30T15:00:00Z'))).toBe(true);
  });
  it('JST 10/31 23:59 まで (UTC 10/31 14:59)', () => {
    expect(isHalloweenSeason(new Date('2026-10-31T14:59:59Z'))).toBe(true);
    expect(isHalloweenSeason(new Date('2026-10-31T15:00:00Z'))).toBe(false);
  });
  it('期間外', () => {
    expect(isHalloweenSeason(new Date('2026-12-24T03:00:00Z'))).toBe(false);
  });
});

describe('resolveSlotTheme', () => {
  const inSeason = new Date('2026-10-21T03:00:00Z');
  const offSeason = new Date('2026-11-15T03:00:00Z');

  it('auto は期間で切り替わる', () => {
    expect(resolveSlotTheme('auto', inSeason)).toBe('halloween');
    expect(resolveSlotTheme('auto', offSeason)).toBe('default');
  });
  it('固定モードは期間に関係なくそのテーマ', () => {
    expect(resolveSlotTheme('halloween', offSeason)).toBe('halloween');
    expect(resolveSlotTheme('default', inSeason)).toBe('default');
  });
});

describe('parseSlotThemeMode', () => {
  it('有効な値はそのまま', () => {
    for (const m of SLOT_THEME_MODES) expect(parseSlotThemeMode(m)).toBe(m);
  });
  it('不正値は既定 (auto)', () => {
    expect(parseSlotThemeMode('christmas')).toBe(DEFAULT_SLOT_THEME_MODE);
    expect(parseSlotThemeMode(null)).toBe(DEFAULT_SLOT_THEME_MODE);
    expect(DEFAULT_SLOT_THEME_MODE).toBe('auto');
  });
});

describe('SLOT_THEME_DEFINITIONS', () => {
  it.each(SLOT_THEMES)('%s: 全絵柄・全役の表示が定義されている', (theme) => {
    const def = SLOT_THEME_DEFINITIONS[theme];
    for (const s of SLOT_SYMBOLS) {
      expect(def.symbolEmoji[s]).toBeTruthy();
      expect(def.symbolLabel[s]).toBeTruthy();
    }
    for (const o of [...SLOT_WINNING_OUTCOMES, 'LOSE' as const]) {
      expect(def.outcomeLabel[o]).toBeTruthy();
    }
  });

  it.each(SLOT_THEMES)('%s: 絵柄の見た目が重複しない', (theme) => {
    const def = SLOT_THEME_DEFINITIONS[theme];
    const emojis = SLOT_SYMBOLS.map((s) => def.symbolEmoji[s]);
    expect(new Set(emojis).size).toBe(SLOT_SYMBOLS.length);
  });

  it('ハロウィンの最高役はジャック・オ・ランタン', () => {
    expect(SLOT_THEME_DEFINITIONS.halloween.symbolEmoji.SEVEN).toBe('🎃');
  });
});
