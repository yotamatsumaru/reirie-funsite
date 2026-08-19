/**
 * ミニゲーム「スロット」の純粋ロジック & 定数。
 *
 * ここには副作用のない関数のみを置く (DB アクセスや乱数の "発生源" は含めない)。
 * 乱数はサーバー側 (apps/web/src/lib/games/slot.ts) で暗号論的乱数を用いて生成し、
 * 本モジュールの判定関数に渡す。クライアントとサーバーで同じ判定を共有することで
 * 表示と実際の当落を一致させつつ、確定はあくまでサーバーが行う。
 *
 * === ルール ===
 *  - 3 リール。各リールに 6 種類の絵柄が入っている。
 *  - 3 つ揃い          … 絵柄ごとの配当 (Pui)
 *  - チェリーが 1 つ以上… 小役 (少額の Pui)
 *  - それ以外          … はずれ (0 Pui)
 *
 * === 「当たりを先に決めてから絵柄を作る」設計にした理由 ===
 * 素直に「各リールを独立に回して、揃ったら当たり」にすると、当選確率が
 * 絵柄の本数だけで決まってしまい、運営が後から出玉率を調整できない。
 * そこで あっち向いてホイ と同じく、
 *   1. 設定 (1〜6) に応じた確率テーブルで「何に当たるか」を先に抽選する
 *   2. その結果に整合するリール絵柄を構成する
 * という順序にしている。これにより出玉率を設定で厳密に制御でき、
 * かつプレイヤーから見た表示 (リールの止まり方) は自然なままになる。
 *
 * === 景表法 / ガチャ規制について ===
 * 本ゲームは「無料プレイ回数の範囲で遊ぶ」ものであり、現金・有価物は一切出ない。
 * 出るのはサイト内でのみ使える Pui のみ。確率もこのファイルに定数として公開しており、
 * 管理画面からも参照できる (射幸性を煽らない・確率を秘匿しない方針)。
 */

import { z } from 'zod';
import { PLAN_TYPES, type PlanTypeLiteral } from './constants';

// ---------------------------------------------------------------------
// 絵柄
// ---------------------------------------------------------------------

/**
 * スロットの絵柄。
 * CHERRY だけは「1 つ以上で小役」という特別扱いをする (実機の定番)。
 */
export const SLOT_SYMBOLS = [
  'CHERRY',
  'BELL',
  'WATERMELON',
  'STAR',
  'HEART',
  'SEVEN',
] as const;

export type SlotSymbol = (typeof SLOT_SYMBOLS)[number];

/** 絵柄の表示用絵文字 (UI で使用) */
export const SLOT_SYMBOL_EMOJI: Record<SlotSymbol, string> = {
  CHERRY: '🍒',
  BELL: '🔔',
  WATERMELON: '🍉',
  STAR: '⭐',
  HEART: '💖',
  SEVEN: '7️⃣',
};

/** 絵柄の表示名 (日本語) */
export const SLOT_SYMBOL_LABEL: Record<SlotSymbol, string> = {
  CHERRY: 'チェリー',
  BELL: 'ベル',
  WATERMELON: 'スイカ',
  STAR: 'スター',
  HEART: 'ハート',
  SEVEN: 'セブン',
};

/** 値が有効な絵柄か */
export function isSlotSymbol(v: unknown): v is SlotSymbol {
  return typeof v === 'string' && (SLOT_SYMBOLS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------
// リール
// ---------------------------------------------------------------------

/** リール数 (3 リール固定) */
export const SLOT_REEL_COUNT = 3;

/** 停止したリールの絵柄 (左・中・右) */
export type SlotReels = readonly [SlotSymbol, SlotSymbol, SlotSymbol];

// ---------------------------------------------------------------------
// 役 (当たりの種類)
// ---------------------------------------------------------------------

/**
 * 役の種類。
 *  - SEVEN/HEART/STAR/WATERMELON/BELL … その絵柄の 3 つ揃い
 *  - CHERRY                            … チェリーが 1 つ以上 (揃わなくてよい小役)
 *  - LOSE                              … はずれ
 */
export type SlotOutcome =
  | 'SEVEN_TRIPLE'
  | 'HEART_TRIPLE'
  | 'STAR_TRIPLE'
  | 'WATERMELON_TRIPLE'
  | 'BELL_TRIPLE'
  | 'CHERRY_SINGLE'
  | 'LOSE';

/** 当たり役の一覧 (LOSE を除く。配当が高い順) */
export const SLOT_WINNING_OUTCOMES: readonly SlotOutcome[] = [
  'SEVEN_TRIPLE',
  'HEART_TRIPLE',
  'STAR_TRIPLE',
  'WATERMELON_TRIPLE',
  'BELL_TRIPLE',
  'CHERRY_SINGLE',
];

/** 3 つ揃い役 → その絵柄 */
export const SLOT_TRIPLE_SYMBOL: Record<
  Exclude<SlotOutcome, 'CHERRY_SINGLE' | 'LOSE'>,
  SlotSymbol
> = {
  SEVEN_TRIPLE: 'SEVEN',
  HEART_TRIPLE: 'HEART',
  STAR_TRIPLE: 'STAR',
  WATERMELON_TRIPLE: 'WATERMELON',
  BELL_TRIPLE: 'BELL',
};

/** 役の表示名 (日本語) */
export const SLOT_OUTCOME_LABEL: Record<SlotOutcome, string> = {
  SEVEN_TRIPLE: 'セブン 3つ揃い',
  HEART_TRIPLE: 'ハート 3つ揃い',
  STAR_TRIPLE: 'スター 3つ揃い',
  WATERMELON_TRIPLE: 'スイカ 3つ揃い',
  BELL_TRIPLE: 'ベル 3つ揃い',
  CHERRY_SINGLE: 'チェリー',
  LOSE: 'はずれ',
};

// ---------------------------------------------------------------------
// 配当 (ベース Pui)
// ---------------------------------------------------------------------

/**
 * 役ごとの獲得 Pui (ベース値)。
 * 実際の付与時はここにプラン倍率 (applyPlanPuiMultiplier) が掛かる。
 *
 * 【バランス設計】あっち向いてホイは「1 日 5 回・勝率 25%・勝てば 32pt」なので
 * 1 日あたり期待値は約 40pt。スロットもこれに近い水準へ揃え、片方だけが
 * 極端に稼げる状態にならないようにしている
 * (実際の期待値は下の slotExpectedValue() で算出できる)。
 */
export const SLOT_PAYOUT: Record<SlotOutcome, number> = {
  SEVEN_TRIPLE: 200,
  HEART_TRIPLE: 100,
  STAR_TRIPLE: 50,
  WATERMELON_TRIPLE: 30,
  BELL_TRIPLE: 20,
  CHERRY_SINGLE: 5,
  LOSE: 0,
};

/** 1 日にプレイできる回数の上限 (あっち向いてホイと同じ 5 回) */
export const SLOT_MAX_PLAYS_PER_DAY = 5;

/** 最高配当 (UI の訴求に使用) */
export const SLOT_MAX_PAYOUT = SLOT_PAYOUT.SEVEN_TRIPLE;

// ---------------------------------------------------------------------
// 設定 (1〜6) と当選確率
// ---------------------------------------------------------------------

/** 設定は 1〜6 の 6 段階 (あっち向いてホイと同じ考え方。数字が大きいほど出やすい) */
export const SLOT_SETTINGS = [1, 2, 3, 4, 5, 6] as const;
export type SlotSetting = (typeof SLOT_SETTINGS)[number];

/** 役ごとの当選確率 (0〜1)。LOSE を除く各役の確率をここで定義する。 */
export type SlotOddsTable = Record<Exclude<SlotOutcome, 'LOSE'>, number>;

/**
 * 設定値 → 役ごとの当選確率。
 *
 * 合計は 1 未満で、残りが「はずれ」になる。
 * 設定が上がるほど当選確率が上がるが、上限でも合計 40% 程度に抑え、
 * 「当たり続けて無限に稼げる」状態にはしない。
 */
export const SLOT_ODDS_BY_SETTING: Record<SlotSetting, SlotOddsTable> = {
  1: {
    SEVEN_TRIPLE: 0.002,
    HEART_TRIPLE: 0.006,
    STAR_TRIPLE: 0.02,
    WATERMELON_TRIPLE: 0.035,
    BELL_TRIPLE: 0.06,
    CHERRY_SINGLE: 0.11,
  },
  2: {
    SEVEN_TRIPLE: 0.003,
    HEART_TRIPLE: 0.008,
    STAR_TRIPLE: 0.025,
    WATERMELON_TRIPLE: 0.04,
    BELL_TRIPLE: 0.07,
    CHERRY_SINGLE: 0.13,
  },
  3: {
    SEVEN_TRIPLE: 0.004,
    HEART_TRIPLE: 0.011,
    STAR_TRIPLE: 0.03,
    WATERMELON_TRIPLE: 0.05,
    BELL_TRIPLE: 0.085,
    CHERRY_SINGLE: 0.15,
  },
  4: {
    SEVEN_TRIPLE: 0.006,
    HEART_TRIPLE: 0.014,
    STAR_TRIPLE: 0.036,
    WATERMELON_TRIPLE: 0.06,
    BELL_TRIPLE: 0.1,
    CHERRY_SINGLE: 0.17,
  },
  5: {
    SEVEN_TRIPLE: 0.008,
    HEART_TRIPLE: 0.018,
    STAR_TRIPLE: 0.044,
    WATERMELON_TRIPLE: 0.07,
    BELL_TRIPLE: 0.115,
    CHERRY_SINGLE: 0.195,
  },
  6: {
    SEVEN_TRIPLE: 0.012,
    HEART_TRIPLE: 0.024,
    STAR_TRIPLE: 0.055,
    WATERMELON_TRIPLE: 0.085,
    BELL_TRIPLE: 0.13,
    CHERRY_SINGLE: 0.22,
  },
};

/** 値が有効な設定 (1〜6) か */
export function isSlotSetting(v: unknown): v is SlotSetting {
  return typeof v === 'number' && (SLOT_SETTINGS as readonly number[]).includes(v);
}

/** 設定値を 1〜6 の範囲にクランプする (壊れた値の保険) */
export function clampSlotSetting(v: number): SlotSetting {
  const rounded = Math.round(v);
  if (rounded < 1) return 1;
  if (rounded > 6) return 6;
  return rounded as SlotSetting;
}

/** 設定値から確率テーブルを引く */
export function slotOdds(setting: SlotSetting): SlotOddsTable {
  return SLOT_ODDS_BY_SETTING[setting] ?? SLOT_ODDS_BY_SETTING[1];
}

/** 設定値における「何かに当たる」確率 (0〜1) */
export function slotTotalWinRate(setting: SlotSetting): number {
  const odds = slotOdds(setting);
  return SLOT_WINNING_OUTCOMES.reduce(
    (sum, o) => sum + (odds[o as Exclude<SlotOutcome, 'LOSE'>] ?? 0),
    0,
  );
}

/** 設定値における 1 プレイあたりの期待獲得 Pui (ベース値・プラン倍率適用前) */
export function slotExpectedValue(setting: SlotSetting): number {
  const odds = slotOdds(setting);
  return SLOT_WINNING_OUTCOMES.reduce((sum, o) => {
    const key = o as Exclude<SlotOutcome, 'LOSE'>;
    return sum + (odds[key] ?? 0) * SLOT_PAYOUT[o];
  }, 0);
}

// ---------------------------------------------------------------------
// 抽選 (純粋関数)
// ---------------------------------------------------------------------

/**
 * [0,1) の乱数値から役を決定する純粋関数。
 *
 * 乱数の "発生源" は持たず、外から渡された値だけで決まるため、
 * テストで境界値を直接検証できる (= 確率テーブルの実装ミスを検出できる)。
 *
 * 配当が高い役から順に区間を割り当て、どの区間にも入らなければ LOSE。
 *
 * @param roll    [0,1) の乱数
 * @param setting 設定 (1〜6)
 */
export function rollSlotOutcome(roll: number, setting: SlotSetting): SlotOutcome {
  const odds = slotOdds(setting);
  let cursor = 0;
  for (const outcome of SLOT_WINNING_OUTCOMES) {
    cursor += odds[outcome as Exclude<SlotOutcome, 'LOSE'>] ?? 0;
    if (roll < cursor) return outcome;
  }
  return 'LOSE';
}

/**
 * 役から獲得 Pui (ベース値) を引く。
 */
export function slotPayout(outcome: SlotOutcome): number {
  return SLOT_PAYOUT[outcome] ?? 0;
}

/** 役が当たり (配当あり) か */
export function isSlotWin(outcome: SlotOutcome): boolean {
  return outcome !== 'LOSE' && slotPayout(outcome) > 0;
}

// ---------------------------------------------------------------------
// リール絵柄の構成 (抽選結果に整合させる)
// ---------------------------------------------------------------------

/**
 * リール絵柄が、指定された役と矛盾していないか検証する。
 *
 * 【なぜ必要か】
 * 「役を先に決めてから絵柄を作る」設計のため、絵柄の構成にバグがあると
 * 「はずれなのに 7 が 3 つ並んでいる」「当たりなのに絵柄がバラバラ」といった
 * 表示と結果の食い違いが起きる。これはプレイヤーからは不正に見えるため、
 * サーバー側で構成した絵柄を必ずこの関数で検証してから返す。
 *
 * @returns 矛盾がなければ true
 */
export function reelsMatchOutcome(reels: SlotReels, outcome: SlotOutcome): boolean {
  const cherryCount = reels.filter((s) => s === 'CHERRY').length;
  const allSame = reels[0] === reels[1] && reels[1] === reels[2];

  if (outcome === 'CHERRY_SINGLE') {
    // チェリーが 1 つ以上あり、かつ 3 つ揃い役になっていないこと。
    // (チェリー 3 つ揃いは CHERRY_SINGLE より上位の役が無いので、
    //  ここでは「揃っていない」ことを要求して役の重複を防ぐ)
    return cherryCount >= 1 && !allSame;
  }

  if (outcome === 'LOSE') {
    // はずれ: 3 つ揃いでなく、チェリーも 1 つも無いこと。
    return !allSame && cherryCount === 0;
  }

  // 3 つ揃い役: 全部同じで、かつその絵柄であること。
  const expected = SLOT_TRIPLE_SYMBOL[outcome];
  return allSame && reels[0] === expected;
}

/**
 * 停止した絵柄から役を判定する (表示 → 役 の逆引き)。
 *
 * サーバーが構成した絵柄の自己検証や、テストでの照合に使う。
 * 判定順は配当の高い順 (3 つ揃い → チェリー小役)。
 */
export function judgeSlotReels(reels: SlotReels): SlotOutcome {
  const allSame = reels[0] === reels[1] && reels[1] === reels[2];
  if (allSame) {
    const symbol = reels[0];
    const found = (
      Object.keys(SLOT_TRIPLE_SYMBOL) as Exclude<SlotOutcome, 'CHERRY_SINGLE' | 'LOSE'>[]
    ).find((o) => SLOT_TRIPLE_SYMBOL[o] === symbol);
    if (found) return found;
    // チェリー 3 つ揃いは専用役を用意していないのでチェリー小役として扱う。
    if (symbol === 'CHERRY') return 'CHERRY_SINGLE';
  }
  if (reels.some((s) => s === 'CHERRY')) return 'CHERRY_SINGLE';
  return 'LOSE';
}

// ---------------------------------------------------------------------
// プラン別設定 (管理画面から変更可能)
// ---------------------------------------------------------------------

/** プラン (FREE / STANDARD / PREMIUM) ごとに割り当てる設定 (1〜6) */
export type SlotSettingsByPlan = Record<PlanTypeLiteral, SlotSetting>;

/** AppSetting に保存するキー */
export const SLOT_SETTINGS_KEY = 'slot.settings';

/**
 * 既定のプラン別設定 (あっち向いてホイと同じ考え方)。
 *  - FREE     : 設定2
 *  - STANDARD : 設定4
 *  - PREMIUM  : 設定6
 */
export const DEFAULT_SLOT_SETTINGS: SlotSettingsByPlan = {
  FREE: 2,
  STANDARD: 4,
  PREMIUM: 6,
};

/** Zod: 設定 (1〜6) */
export const SlotSettingSchema = z
  .number()
  .int()
  .min(1)
  .max(6) as unknown as z.ZodType<SlotSetting>;

/** Zod: プラン別設定マップ (FREE/STANDARD/PREMIUM すべて必須) */
export const SlotSettingsByPlanSchema = z.object(
  Object.fromEntries(PLAN_TYPES.map((p) => [p, SlotSettingSchema])) as Record<
    PlanTypeLiteral,
    typeof SlotSettingSchema
  >,
) as unknown as z.ZodType<SlotSettingsByPlan>;

/** プランに対応する設定値を引く (未定義プランは FREE 既定にフォールバック) */
export function resolveSlotSettingForPlan(
  settings: SlotSettingsByPlan,
  plan: PlanTypeLiteral,
): SlotSetting {
  return settings[plan] ?? DEFAULT_SLOT_SETTINGS[plan] ?? 2;
}

/** 残りプレイ回数を計算する (負にはならない) */
export function slotRemainingPlays(
  playedToday: number,
  maxPerDay = SLOT_MAX_PLAYS_PER_DAY,
): number {
  return Math.max(0, maxPerDay - playedToday);
}
