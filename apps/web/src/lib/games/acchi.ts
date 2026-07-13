/**
 * あっち向いてホイ — サーバー側の権威ある進行ロジック。
 *
 * クライアントは「じゃんけんの手」と「方向」しか送らない。
 * CPU の手・方向・勝敗はここ (サーバー) で暗号論的乱数を用いて生成・確定する。
 * 結果やポイントをクライアントから受け取らないことで、不正なポイント獲得を
 * 構造的に不可能にする。
 *
 * === ルール (2ラウンド制・正式版) ===
 *  ラウンド1 (じゃんけん):
 *    - CPU の手は公正な乱数 (グー・チョキ・パーを約1/3ずつ) で決める。
 *    - プレイヤーが負けたら、その場でゲーム終了 (最終結果 LOSE)。
 *    - あいこなら、ラウンド1をやり直す (CPU の手を再抽選)。
 *    - プレイヤーが勝ったら、ラウンド2 (方向) に進む。
 *  ラウンド2 (方向):
 *    - プレイヤーが指した方向と CPU が向いた方向が一致すればプレイヤーの勝ち、
 *      不一致であれば負け。
 *    - 「一致するかどうか」自体は、プレイヤーのプランに割り当てられた
 *      設定 (1〜6) の勝率 (acchiWinRate) で抽選する。CPU の方向はこの
 *      抽選結果に整合するよう構成する (勝率は設定どおり厳密に制御される)。
 *
 *  クライアントは「手」と「方向」を最初にまとめて送信する (1 リクエスト)。
 *  ラウンド1 のやり直し (あいこ) はサーバー内部でループ処理し、
 *  レスポンスに全ラウンド1試行のログ (round1.attempts) を含めることで、
 *  クライアント側は「あいこ→もう一回」の演出をアニメーションで見せられる。
 */
import { randomInt } from 'node:crypto';
import {
  judgeJanken,
  decideAcchiRound1,
  judgeAcchiRound2,
  JANKEN_HANDS,
  ACCHI_DIRECTIONS,
  acchiWinRate,
  type JankenHand,
  type AcchiDirection,
  type JankenOutcome,
  type AcchiResult,
  type AcchiWinSetting,
} from '@idol/shared';

/** 暗号論的乱数で CPU のじゃんけんの手を選ぶ (公正: 約1/3ずつ) */
export function randomCpuHand(): JankenHand {
  return JANKEN_HANDS[randomInt(JANKEN_HANDS.length)];
}

/** [0,1) の暗号論的乱数 */
function randomUnit(): number {
  return randomInt(0, 0x100000000) / 0x100000000;
}

/** 配列から暗号論的乱数で 1 つ選ぶ */
function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(arr.length)];
}

/** プレイヤーの指した方向とは異なる方向を暗号論的乱数で 1 つ選ぶ (不一致用) */
function pickMismatchedDirection(exclude: AcchiDirection): AcchiDirection {
  const candidates = ACCHI_DIRECTIONS.filter((d) => d !== exclude);
  return pick(candidates);
}

/** ラウンド1 (じゃんけん) の 1 回の試行結果 */
export type AcchiRound1Attempt = {
  player: JankenHand;
  cpu: JankenHand;
  outcome: JankenOutcome;
};

/** ラウンド1 (じゃんけん) 全体の結果 (あいこによるやり直しを含む) */
export type AcchiRound1Result = {
  /** 全試行 (最後の要素が決着した試行 = WIN か LOSE) */
  attempts: AcchiRound1Attempt[];
  /** 決着した試行 (attempts の最後の要素と同じ) */
  decisive: AcchiRound1Attempt;
};

/** ラウンド2 (方向) の結果。ラウンド1で負けた場合は行われない (null)。 */
export type AcchiRound2Result = {
  player: AcchiDirection;
  cpu: AcchiDirection;
  matched: boolean;
  setting: AcchiWinSetting;
};

export type AcchiPlayResolution = {
  result: AcchiResult;
  round1: AcchiRound1Result;
  round2: AcchiRound2Result | null;
};

/** ラウンド1の無限ループ対策 (あいこが異常に連続した場合の保険) */
const MAX_ROUND1_ATTEMPTS = 50;

/**
 * ラウンド1 (じゃんけん) を、決着 (WIN または LOSE) するまで解決する。
 * あいこの場合は CPU の手を再抽選してやり直す。
 */
function resolveRound1(playerHand: JankenHand): AcchiRound1Result {
  const attempts: AcchiRound1Attempt[] = [];
  for (let i = 0; i < MAX_ROUND1_ATTEMPTS; i++) {
    const cpu = randomCpuHand();
    const outcome = judgeJanken(playerHand, cpu);
    const attempt: AcchiRound1Attempt = { player: playerHand, cpu, outcome };
    attempts.push(attempt);
    const decision = decideAcchiRound1(outcome);
    if (decision !== 'RETRY') {
      return { attempts, decisive: attempt };
    }
  }
  // 実質発生しない保険 (1/3^50 未満の確率): 最後の試行を決着扱いにする。
  const last = attempts[attempts.length - 1];
  return { attempts, decisive: last };
}

/**
 * ラウンド2 (方向) を、設定 (1〜6) の勝率に従って解決する。
 * 一致/不一致の抽選結果に整合する CPU の方向を構成する。
 */
function resolveRound2(playerDirection: AcchiDirection, setting: AcchiWinSetting): AcchiRound2Result {
  const winRate = acchiWinRate(setting);
  const matched = randomUnit() < winRate;
  return buildRound2(playerDirection, matched, setting);
}

/**
 * ラウンド1 (じゃんけん) だけを解決する (2段階フローのフェーズ1用)。
 * あいこは内部でやり直し、決着 (WIN / LOSE) するまでループする。
 *
 * 2段階フロー:
 *   フェーズ1: プレイヤーの「手」だけを受け取り、じゃんけん (このラウンド1) を確定する。
 *             ここでプレイ回数を 1 消費する。
 *   フェーズ2: じゃんけんに勝った場合のみ、プレイヤーの「方向」を受け取り
 *             ラウンド2 (方向対決) を解決する。
 */
export function resolveAcchiRound1(playerHand: JankenHand): AcchiRound1Result {
  return resolveRound1(playerHand);
}

/**
 * 勝率抽選の結果 (matched) から、それに整合する CPU の方向を構成して
 * ラウンド2 の結果オブジェクトを組み立てる純粋関数。
 *
 * 2段階フローのフェーズ1で「勝つか負けるか (matched)」を先に確定しておき、
 * フェーズ2でプレイヤーが実際に指した方向に合わせて CPU の方向を後から
 * 構成するために使う (勝敗は matched で既に決まっているため、方向の見た目を
 * 整合させるだけ)。
 */
export function buildRound2(
  playerDirection: AcchiDirection,
  matched: boolean,
  setting: AcchiWinSetting,
): AcchiRound2Result {
  const cpu = matched ? playerDirection : pickMismatchedDirection(playerDirection);
  return { player: playerDirection, cpu, matched, setting };
}

/**
 * 設定 (1〜6) の勝率に従って「方向対決に勝つか (matched)」だけを抽選する。
 * CPU の方向は含まない (プレイヤーの方向が未確定な段階=フェーズ1で使う)。
 */
export function rollRound2Matched(setting: AcchiWinSetting): boolean {
  return randomUnit() < acchiWinRate(setting);
}

/**
 * 1 プレイを解決する (2ラウンド制)。
 *
 *  1. ラウンド1 (じゃんけん) を決着まで解決する。
 *     - 負け → ここでゲーム終了 (result: LOSE, round2: null)。
 *     - 勝ち → ラウンド2 へ。
 *  2. ラウンド2 (方向) を設定の勝率で解決する。
 *     - 一致 → result: WIN / 不一致 → result: LOSE。
 */
export function resolveAcchiPlay(
  playerHand: JankenHand,
  playerDirection: AcchiDirection,
  setting: AcchiWinSetting,
): AcchiPlayResolution {
  const round1 = resolveRound1(playerHand);

  if (decideAcchiRound1(round1.decisive.outcome) === 'GAME_OVER') {
    return { result: 'LOSE', round1, round2: null };
  }

  const round2 = resolveRound2(playerDirection, setting);
  const result = judgeAcchiRound2(round2.matched);
  return { result, round1, round2 };
}
