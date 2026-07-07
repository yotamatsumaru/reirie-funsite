/**
 * ミニゲーム「あっち向いてホイ」の純粋ロジック & 定数。
 *
 * ここには副作用のない関数のみを置く (DB アクセスや乱数の "発生源" は含めない)。
 * 乱数はサーバー側 (apps/web/src/lib/games/acchi.ts) で生成し、本モジュールの
 * 判定関数に渡す。クライアントとサーバーで同じ判定を共有することで、表示と
 * 実際の勝敗ロジックを一致させる (勝敗の確定はあくまでサーバーが行う)。
 */

import { z } from 'zod';
import { PLAN_TYPES, type PlanTypeLiteral } from './constants';

// ---------------------------------------------------------------------
// 定数 (ゲームバランス)
// ---------------------------------------------------------------------

/** 1 日にプレイできる回数の上限 */
export const ACCHI_MAX_PLAYS_PER_DAY = 5;

/** あっち向いてホイで「プレイヤーが勝った」ときに付与するポイント */
export const ACCHI_WIN_REWARD = 30;

// ---------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------

/** じゃんけんの手 */
export type JankenHand = 'ROCK' | 'SCISSORS' | 'PAPER';

/** あっち向いてホイの方向 */
export type AcchiDirection = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

/** じゃんけんの結果 (プレイヤー視点) */
export type JankenOutcome = 'WIN' | 'LOSE' | 'DRAW';

/** プレイ全体の結果 (プレイヤー視点) */
export type AcchiResult = 'WIN' | 'LOSE' | 'DRAW';

export const JANKEN_HANDS: readonly JankenHand[] = ['ROCK', 'SCISSORS', 'PAPER'];
export const ACCHI_DIRECTIONS: readonly AcchiDirection[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

// ---------------------------------------------------------------------
// 判定ロジック (純粋関数)
// ---------------------------------------------------------------------

/** 値が有効なじゃんけんの手か */
export function isJankenHand(v: unknown): v is JankenHand {
  return v === 'ROCK' || v === 'SCISSORS' || v === 'PAPER';
}

/** 値が有効な方向か */
export function isAcchiDirection(v: unknown): v is AcchiDirection {
  return v === 'UP' || v === 'DOWN' || v === 'LEFT' || v === 'RIGHT';
}

/**
 * じゃんけんの勝敗をプレイヤー視点で判定する。
 * ROCK > SCISSORS > PAPER > ROCK
 */
export function judgeJanken(player: JankenHand, cpu: JankenHand): JankenOutcome {
  if (player === cpu) return 'DRAW';
  const beats: Record<JankenHand, JankenHand> = {
    ROCK: 'SCISSORS',
    SCISSORS: 'PAPER',
    PAPER: 'ROCK',
  };
  return beats[player] === cpu ? 'WIN' : 'LOSE';
}

/**
 * あっち向いてホイの最終結果を判定する。
 *
 * - じゃんけんがあいこ → ゲームもDRAW (もう一度じゃんけんからやり直す UI 想定)
 * - じゃんけんに勝った側が「指を差す」、負けた側が「顔を向ける」。
 *   指した方向と向いた方向が一致したら "指した側" の勝ち。
 *
 * @param janken じゃんけんのプレイヤー視点の結果
 * @param playerDir じゃんけんの結果に応じてプレイヤーが選んだ方向
 *                  (勝ったとき=指す方向 / 負けたとき=顔を向ける方向)
 * @param cpuDir 同様に CPU が選んだ方向
 */
export function judgeAcchi(
  janken: JankenOutcome,
  playerDir: AcchiDirection,
  cpuDir: AcchiDirection,
): AcchiResult {
  if (janken === 'DRAW') return 'DRAW';
  const matched = playerDir === cpuDir;
  if (janken === 'WIN') {
    // プレイヤーが指す側。一致すれば CPU が釣られた → プレイヤー勝ち。
    return matched ? 'WIN' : 'DRAW';
  }
  // janken === 'LOSE' → CPU が指す側。一致すればプレイヤーが釣られた → プレイヤー負け。
  return matched ? 'LOSE' : 'DRAW';
}

/** 残りプレイ回数を計算する (負にはならない) */
export function remainingPlays(playedToday: number, maxPerDay = ACCHI_MAX_PLAYS_PER_DAY): number {
  return Math.max(0, maxPerDay - playedToday);
}

// ---------------------------------------------------------------------
// 勝率設定 (パチンコ風 設定 1〜6)
// ---------------------------------------------------------------------

/**
 * あっち向いてホイの「設定」は 1〜6 の 6 段階。
 * 数字が大きいほどプレイヤーが勝ちやすい (= 高設定)。パチンコ/パチスロの "設定" を踏襲。
 */
export const ACCHI_WIN_SETTINGS = [1, 2, 3, 4, 5, 6] as const;
export type AcchiWinSetting = (typeof ACCHI_WIN_SETTINGS)[number];

/**
 * 設定値 → 「最終的にプレイヤーが勝つ確率」(0〜1)。
 * あっち向いてホイは決着がつくまで繰り返すゲームなので、
 * ここでは "1 プレイ (= 決着 1 回) で WIN になる確率" を直接定義する。
 * (実際のじゃんけん/方向の出目は、この確率に整合するようサーバーが構成する)
 */
export const ACCHI_WIN_RATE_BY_SETTING: Record<AcchiWinSetting, number> = {
  1: 0.2, // 設定1: 約20%
  2: 0.25, // 設定2: 約25%
  3: 0.33, // 設定3: 約33%
  4: 0.4, // 設定4: 約40%
  5: 0.5, // 設定5: 約50%
  6: 0.6, // 設定6: 約60%
};

/** 値が有効な設定 (1〜6) か */
export function isAcchiWinSetting(v: unknown): v is AcchiWinSetting {
  return typeof v === 'number' && ACCHI_WIN_SETTINGS.includes(v as AcchiWinSetting);
}

/** 設定値を 1〜6 の範囲にクランプする (壊れた値の保険) */
export function clampAcchiWinSetting(v: number): AcchiWinSetting {
  const rounded = Math.round(v);
  if (rounded < 1) return 1;
  if (rounded > 6) return 6;
  return rounded as AcchiWinSetting;
}

/** 設定値からプレイヤー勝率 (0〜1) を引く */
export function acchiWinRate(setting: AcchiWinSetting): number {
  return ACCHI_WIN_RATE_BY_SETTING[setting];
}

/**
 * プラン (FREE / STANDARD / PREMIUM) ごとに割り当てる設定 (1〜6)。
 * 管理者が /super-admin/game で変更し、AppSetting (acchi.winSettings) に永続化する。
 */
export type AcchiWinSettingsByPlan = Record<PlanTypeLiteral, AcchiWinSetting>;

/** AppSetting に保存するキー */
export const ACCHI_WIN_SETTINGS_KEY = 'acchi.winSettings';

/**
 * 既定のプラン別設定。
 *  - FREE     : 設定2 (約25%)
 *  - STANDARD : 設定4 (約40%)
 *  - PREMIUM  : 設定6 (約60%)
 * 上位プランほど勝ちやすい初期バランス。
 */
export const DEFAULT_ACCHI_WIN_SETTINGS: AcchiWinSettingsByPlan = {
  FREE: 2,
  STANDARD: 4,
  PREMIUM: 6,
};

/** Zod: 設定 (1〜6) */
export const AcchiWinSettingSchema = z
  .number()
  .int()
  .min(1)
  .max(6) as unknown as z.ZodType<AcchiWinSetting>;

/** Zod: プラン別設定マップ (FREE/STANDARD/PREMIUM すべて必須) */
export const AcchiWinSettingsByPlanSchema = z.object(
  Object.fromEntries(PLAN_TYPES.map((p) => [p, AcchiWinSettingSchema])) as Record<
    PlanTypeLiteral,
    typeof AcchiWinSettingSchema
  >,
) as unknown as z.ZodType<AcchiWinSettingsByPlan>;

/** プランに対応する設定値を引く (未定義プランは FREE 既定にフォールバック) */
export function resolveAcchiSettingForPlan(
  settings: AcchiWinSettingsByPlan,
  plan: PlanTypeLiteral,
): AcchiWinSetting {
  return settings[plan] ?? DEFAULT_ACCHI_WIN_SETTINGS[plan] ?? 2;
}

// ---------------------------------------------------------------------
// 勝利による特典ポイント付与 (Fan ポイントとは別枠のボーナス)
//
// Fan ポイントは無料で貯まる (ログイン等) ため、そのまま特典ポイントに
// 交換できてしまうと課金経済 (Stripe 購入 / サブスク特典) が薄まってしまう。
// そのため「あっち向いてホイ」の勝利に限り、ごく薄い還元率 + 1日上限を設けて
// 少量の特典ポイントを付与する、という抑制的なボーナスとして実装する。
// ---------------------------------------------------------------------

/** 1 勝あたりに付与する特典ポイント (既定値) */
export const ACCHI_REWARD_POINT_PER_WIN = 1;

/** 1 日に付与できる特典ポイントの上限 (既定値) */
export const ACCHI_REWARD_POINT_DAILY_CAP = 3;

/**
 * あっち向いてホイの勝利特典ポイント設定。
 * 管理者が /super-admin/game で変更し、AppSetting (acchi.rewardBonusSettings) に永続化する。
 */
export type AcchiRewardBonusSettings = {
  /** 1 勝あたりに付与する特典ポイント */
  perWin: number;
  /** 1 日 (JST) に付与できる特典ポイントの上限 */
  dailyCap: number;
};

/** AppSetting に保存するキー */
export const ACCHI_REWARD_BONUS_SETTINGS_KEY = 'acchi.rewardBonusSettings';

/** 既定の勝利特典ポイント設定 (1勝 = 1pt, 1日上限3pt という薄い還元率) */
export const DEFAULT_ACCHI_REWARD_BONUS_SETTINGS: AcchiRewardBonusSettings = {
  perWin: ACCHI_REWARD_POINT_PER_WIN,
  dailyCap: ACCHI_REWARD_POINT_DAILY_CAP,
};

/** Zod: 勝利特典ポイント設定 (0 以上の整数。0 にすると事実上ボーナスを無効化できる) */
export const AcchiRewardBonusSettingsSchema = z.object({
  perWin: z.number().int().min(0).max(1000),
  dailyCap: z.number().int().min(0).max(1000),
}) satisfies z.ZodType<AcchiRewardBonusSettings>;

/**
 * 今回の勝利で実際に付与すべき特典ポイントを計算する (純粋関数)。
 *
 * - 負けている場合や設定が 0 の場合は 0。
 * - 既に本日の上限まで付与済みの場合は 0。
 * - 上限に近い場合は端数分 (残り枠) のみを付与する (perWin をそのまま超えて付与しない)。
 *
 * @param result このプレイの結果
 * @param grantedToday 本日 (JST) 既に付与済みの特典ポイント合計
 * @param settings 勝利特典ポイント設定 (perWin / dailyCap)
 */
export function computeAcchiRewardBonus(
  result: AcchiResult,
  grantedToday: number,
  settings: AcchiRewardBonusSettings = DEFAULT_ACCHI_REWARD_BONUS_SETTINGS,
): number {
  if (result !== 'WIN') return 0;
  const remainingCap = Math.max(0, settings.dailyCap - Math.max(0, grantedToday));
  return Math.max(0, Math.min(settings.perWin, remainingCap));
}
