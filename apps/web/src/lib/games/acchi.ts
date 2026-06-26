/**
 * あっち向いてホイ — サーバー側の権威ある進行ロジック。
 *
 * クライアントは「じゃんけんの手」と「方向」しか送らない。
 * CPU の手・方向はここ (サーバー) で暗号論的乱数を用いて生成し、
 * 勝敗を確定する。結果やポイントをクライアントから受け取らないことで、
 * 不正なポイント獲得を構造的に不可能にする。
 */
import { randomInt } from 'node:crypto';
import {
  judgeJanken,
  judgeAcchi,
  JANKEN_HANDS,
  ACCHI_DIRECTIONS,
  type JankenHand,
  type AcchiDirection,
  type JankenOutcome,
  type AcchiResult,
} from '@idol/shared';

/** 暗号論的乱数で CPU のじゃんけんの手を選ぶ */
export function randomCpuHand(): JankenHand {
  return JANKEN_HANDS[randomInt(JANKEN_HANDS.length)];
}

/** 暗号論的乱数で CPU の方向を選ぶ */
export function randomCpuDirection(): AcchiDirection {
  return ACCHI_DIRECTIONS[randomInt(ACCHI_DIRECTIONS.length)];
}

export type AcchiRoundResolution = {
  jankenPlayer: JankenHand;
  jankenCpu: JankenHand;
  jankenOutcome: JankenOutcome;
  /** プレイヤーが選んだ方向 (じゃんけんあいこ時は無視される) */
  playerDirection: AcchiDirection;
  cpuDirection: AcchiDirection;
  result: AcchiResult;
};

/**
 * 1 ラウンドを解決する。
 * じゃんけんがあいこなら方向は判定に使われず、result は DRAW。
 */
export function resolveAcchiRound(
  playerHand: JankenHand,
  playerDirection: AcchiDirection,
): AcchiRoundResolution {
  const jankenCpu = randomCpuHand();
  const jankenOutcome = judgeJanken(playerHand, jankenCpu);
  const cpuDirection = randomCpuDirection();
  const result = judgeAcchi(jankenOutcome, playerDirection, cpuDirection);
  return {
    jankenPlayer: playerHand,
    jankenCpu,
    jankenOutcome,
    playerDirection,
    cpuDirection,
    result,
  };
}
