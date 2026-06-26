/**
 * ミニゲーム「あっち向いてホイ」の純粋ロジック & 定数。
 *
 * ここには副作用のない関数のみを置く (DB アクセスや乱数の "発生源" は含めない)。
 * 乱数はサーバー側 (apps/web/src/lib/games/acchi.ts) で生成し、本モジュールの
 * 判定関数に渡す。クライアントとサーバーで同じ判定を共有することで、表示と
 * 実際の勝敗ロジックを一致させる (勝敗の確定はあくまでサーバーが行う)。
 */

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
