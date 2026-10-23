/**
 * スロットの「見た目テーマ」(通常 / ハロウィン 等の季節イベント)。
 *
 * === 設計方針 ===
 * テーマが変えるのは **表示 (絵文字・名前・文言・配色) だけ**。
 * 内部の絵柄 ID (CHERRY / BELL / ...)・役・確率・配当・DB に記録される値は
 * テーマに関係なく共通にしている。
 *  - 出玉率や景表法上の確率公開がテーマ切替で変わらない
 *  - 過去のプレイ履歴 (detail JSON) の互換性が保たれる
 *  - Unity 等のクライアントは従来どおり絵柄 ID で処理でき、theme を見て
 *    任意に見た目を差し替えられる (追加フィールドなので後方互換)
 *
 * === 切り替え方 ===
 * AppSetting `slot.theme` に mode を保存する (スーパー管理者画面から変更)。
 *  - auto      : 期間内 (ハロウィン = JST 10/1〜10/31) は自動でハロウィン、それ以外は通常
 *  - default   : 常に通常
 *  - halloween : 常にハロウィン (期間外の先行公開・延長用)
 */
import { z } from 'zod';
import {
  SLOT_SYMBOL_EMOJI,
  SLOT_SYMBOL_LABEL,
  SLOT_OUTCOME_LABEL,
  type SlotOutcome,
  type SlotSymbol,
} from './slot-game';

/** 実際に表示されるテーマ */
export const SLOT_THEMES = ['default', 'halloween'] as const;
export type SlotTheme = (typeof SLOT_THEMES)[number];

/** 管理画面で選べるモード (auto = 期間で自動切替) */
export const SLOT_THEME_MODES = ['auto', 'default', 'halloween'] as const;
export type SlotThemeMode = (typeof SLOT_THEME_MODES)[number];

export const SlotThemeModeSchema = z.enum(SLOT_THEME_MODES);

/** AppSetting キー */
export const SLOT_THEME_KEY = 'slot.theme';
export const DEFAULT_SLOT_THEME_MODE: SlotThemeMode = 'auto';

export const SLOT_THEME_MODE_LABEL: Record<SlotThemeMode, string> = {
  auto: '自動 (ハロウィン期間 10/1〜10/31 だけハロウィン)',
  default: '通常 (常に)',
  halloween: 'ハロウィン (常に)',
};

/** テーマごとの表示定義 */
export type SlotThemeDefinition = {
  /** 画面タイトル */
  title: string;
  /** タイトル下のキャッチコピー (最高配当の前に付く) */
  tagline: string;
  symbolEmoji: Record<SlotSymbol, string>;
  symbolLabel: Record<SlotSymbol, string>;
  outcomeLabel: Record<SlotOutcome, string>;
  /** 当たり時の見出しの後ろに付ける一言 */
  winSuffix: string;
  loseTitle: string;
  loseMessage: string;
  idleMessage: string;
  spinningMessage: string;
};

const HALLOWEEN_EMOJI: Record<SlotSymbol, string> = {
  CHERRY: '🍬',
  BELL: '🕯️',
  WATERMELON: '🔮',
  STAR: '🦇',
  HEART: '👻',
  SEVEN: '🎃',
};

const HALLOWEEN_LABEL: Record<SlotSymbol, string> = {
  CHERRY: 'キャンディ',
  BELL: 'キャンドル',
  WATERMELON: '水晶玉',
  STAR: 'コウモリ',
  HEART: 'おばけ',
  SEVEN: 'ジャック・オ・ランタン',
};

export const SLOT_THEME_DEFINITIONS: Record<SlotTheme, SlotThemeDefinition> = {
  default: {
    title: 'スロット',
    tagline: '絵柄が揃うと Pui ゲット！最高',
    symbolEmoji: SLOT_SYMBOL_EMOJI,
    symbolLabel: SLOT_SYMBOL_LABEL,
    outcomeLabel: SLOT_OUTCOME_LABEL,
    winSuffix: '！',
    loseTitle: 'はずれ…',
    loseMessage: '次こそ揃えよう！',
    idleMessage: 'レバーを押してスタート！',
    spinningMessage: '回転中…',
  },
  halloween: {
    title: 'ハロウィンスロット',
    tagline: 'Trick or Treat！ おばけたちを揃えて Pui ゲット！最高',
    symbolEmoji: HALLOWEEN_EMOJI,
    symbolLabel: HALLOWEEN_LABEL,
    outcomeLabel: {
      SEVEN_TRIPLE: `${HALLOWEEN_LABEL.SEVEN} 3つ揃い`,
      HEART_TRIPLE: `${HALLOWEEN_LABEL.HEART} 3つ揃い`,
      STAR_TRIPLE: `${HALLOWEEN_LABEL.STAR} 3つ揃い`,
      WATERMELON_TRIPLE: `${HALLOWEEN_LABEL.WATERMELON} 3つ揃い`,
      BELL_TRIPLE: `${HALLOWEEN_LABEL.BELL} 3つ揃い`,
      CHERRY_SINGLE: HALLOWEEN_LABEL.CHERRY,
      LOSE: 'はずれ',
    },
    winSuffix: '！ Happy Halloween 🎃',
    loseTitle: 'いたずらされちゃった…👻',
    loseMessage: 'お菓子をもらえるまで、もう一回！',
    idleMessage: 'Trick or Treat！ レバーを押してスタート',
    spinningMessage: 'ゴーストが回してるよ…',
  },
};

/** JST の月 (1〜12) と日 */
function jstMonthDay(now: Date): { month: number; day: number } {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return { month: jst.getUTCMonth() + 1, day: jst.getUTCDate() };
}

/** ハロウィン期間か (JST 10/1 00:00 〜 10/31 23:59) */
export function isHalloweenSeason(now: Date = new Date()): boolean {
  return jstMonthDay(now).month === 10;
}

/** モード + 現在時刻 → 実際に表示するテーマ */
export function resolveSlotTheme(
  mode: SlotThemeMode,
  now: Date = new Date(),
): SlotTheme {
  if (mode === 'default' || mode === 'halloween') return mode;
  return isHalloweenSeason(now) ? 'halloween' : 'default';
}

/** 保存値を安全にモードへ変換する (不正値は既定の auto) */
export function parseSlotThemeMode(raw: unknown): SlotThemeMode {
  const parsed = SlotThemeModeSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_SLOT_THEME_MODE;
}
