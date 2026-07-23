/**
 * ミニゲーム「あっち向いてホイ」の純粋ロジック & 定数。
 *
 * ここには副作用のない関数のみを置く (DB アクセスや乱数の "発生源" は含めない)。
 * 乱数はサーバー側 (apps/web/src/lib/games/acchi.ts) で生成し、本モジュールの
 * 判定関数に渡す。クライアントとサーバーで同じ判定を共有することで、表示と
 * 実際の勝敗ロジックを一致させる (勝敗の確定はあくまでサーバーが行う)。
 *
 * ゲームルールは「方向対決」の 1 ラウンドのみ (じゃんけんは廃止済み)。
 * プレイヤーが指した方向と CPU が向いた方向が一致すれば勝ち、不一致であれば負け。
 */

import { z } from 'zod';
import { PLAN_TYPES, type PlanTypeLiteral } from './constants';

// ---------------------------------------------------------------------
// 定数 (ゲームバランス)
// ---------------------------------------------------------------------

/** 1 日にプレイできる回数の上限 */
export const ACCHI_MAX_PLAYS_PER_DAY = 5;

/**
 * あっち向いてホイで「プレイヤーが勝った」ときに付与する Pui。
 *
 * 【2026-07 統合】以前は勝利報酬を Fan ポイント 30pt + 特典ポイント
 * (1勝1pt, 1日上限3pt の薄いボーナス) の 2 枠に分けて付与していたが、
 * Fan ポイント 1 種類への統合に伴い特典ポイント枠は廃止し、その分の
 * 経済性を維持するため Fan ポイント報酬をこの 1 本 (32pt) に増額した。
 * 【2026-07 通貨名変更】さらに通貨名を「Fan ポイント」から「Pui」へ変更した。
 */
export const ACCHI_WIN_REWARD = 32;

// ---------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------

/** あっち向いてホイの方向 */
export type AcchiDirection = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

/** プレイ全体の結果 (プレイヤー視点)。方向が一致すれば WIN、不一致なら LOSE。 */
export type AcchiResult = 'WIN' | 'LOSE';

export const ACCHI_DIRECTIONS: readonly AcchiDirection[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

// ---------------------------------------------------------------------
// 判定ロジック (純粋関数)
// ---------------------------------------------------------------------

/** 値が有効な方向か */
export function isAcchiDirection(v: unknown): v is AcchiDirection {
  return v === 'UP' || v === 'DOWN' || v === 'LEFT' || v === 'RIGHT';
}

/**
 * あっち向いてホイ — 指した方向と向いた方向の一致/不一致から最終結果を判定する。
 *
 * 指した方向と向いた方向が一致 (matched) すればプレイヤーの勝ち、
 * 不一致であればプレイヤーの負け。
 *
 * この「一致するかどうか」自体は、設定 (1〜6) に基づく勝率
 * (acchiWinRate) で抽選される (=CPU の方向はこの結果に整合するよう構成する)。
 *
 * @param matched 指した方向と向いた方向が一致したか
 */
export function judgeAcchiResult(matched: boolean): AcchiResult {
  return matched ? 'WIN' : 'LOSE';
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
 * (実際の方向の出目は、この確率に整合するようサーバーが構成する)
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
// 【2026-07 廃止】勝利による特典ポイント付与 (Fan ポイント/Pui とは別枠のボーナス)
//
// 以前は Fan ポイントとは別枠の「特典ポイント」通貨があり、あっち向いてホイの
// 勝利に限り薄い還元率 (1勝1pt, 1日上限3pt) で少量付与していたが、
// Fan ポイント 1 種類への統合に伴いこの別枠ボーナス機構は廃止した。
// 廃止分の経済性は ACCHI_WIN_REWARD の増額 (30pt → 32pt) で相殺している。
// その後の通貨名変更で Fan ポイントは「Pui」に改称された。
// ---------------------------------------------------------------------
