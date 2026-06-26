/**
 * あっち向いてホイ — サーバー側の権威ある進行ロジック。
 *
 * クライアントは「じゃんけんの手」と「方向」しか送らない。
 * CPU の手・方向・勝敗はここ (サーバー) で暗号論的乱数を用いて生成・確定する。
 * 結果やポイントをクライアントから受け取らないことで、不正なポイント獲得を
 * 構造的に不可能にする。
 *
 * === ルール (正式版) ===
 *  1. じゃんけんで勝負する。
 *  2. 勝った側が「攻撃側」となり、方向を指す。
 *  3. 負けた側 (守備側) が顔をその方向に向ける。
 *  4. 指した方向 == 向いた方向 なら攻撃側の勝ち (= 決着)。
 *  5. 一致しなければ、またじゃんけんからやり直す (= 決着がつくまで繰り返す)。
 *
 * === 勝率「設定」(パチンコ風 1〜6) ===
 *  「最終的にプレイヤーが勝つ確率」は、プレイヤーのプランに割り当てられた
 *  設定 (1〜6) で決まる (acchiWinRate 参照)。
 *  サーバーはまずこの確率で WIN/LOSE を抽選し、その結果に整合する
 *  じゃんけん & 方向の "出目シーケンス" を構成する。これにより:
 *    - 勝率は設定どおり厳密に制御される
 *    - UI に見せるじゃんけん/方向のアニメも結果と矛盾しない
 *  あいこ (DRAW) は「決着までやり直す」ルールなので最終結果には現れない
 *  (途中のやり直し演出としてシーケンスには含めうる)。
 */
import { randomInt } from 'node:crypto';
import {
  judgeJanken,
  JANKEN_HANDS,
  ACCHI_DIRECTIONS,
  acchiWinRate,
  type JankenHand,
  type AcchiDirection,
  type JankenOutcome,
  type AcchiResult,
  type AcchiWinSetting,
} from '@idol/shared';

/** 暗号論的乱数で CPU のじゃんけんの手を選ぶ */
export function randomCpuHand(): JankenHand {
  return JANKEN_HANDS[randomInt(JANKEN_HANDS.length)];
}

/** 暗号論的乱数で CPU の方向を選ぶ */
export function randomCpuDirection(): AcchiDirection {
  return ACCHI_DIRECTIONS[randomInt(ACCHI_DIRECTIONS.length)];
}

/** [0,1) の暗号論的乱数 */
function randomUnit(): number {
  // randomInt(0, 2^32) / 2^32 で十分な精度の一様乱数を得る
  return randomInt(0, 0x100000000) / 0x100000000;
}

/** 配列から暗号論的乱数で 1 つ選ぶ */
function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(arr.length)];
}

/** player の手に「勝つ / 負ける / あいこ」となる CPU の手を返す */
function cpuHandForOutcome(playerHand: JankenHand, outcome: JankenOutcome): JankenHand {
  // judgeJanken はプレイヤー視点。player が outcome になる CPU の手を探す。
  for (const cpu of JANKEN_HANDS) {
    if (judgeJanken(playerHand, cpu) === outcome) return cpu;
  }
  // 理論上到達しない
  return playerHand;
}

/**
 * 後方互換のために残す旧 1 ラウンド解決 (現在は未使用)。
 * @deprecated resolveAcchiPlay を使うこと。
 */
export type AcchiRoundResolution = {
  jankenPlayer: JankenHand;
  jankenCpu: JankenHand;
  jankenOutcome: JankenOutcome;
  playerDirection: AcchiDirection;
  cpuDirection: AcchiDirection;
  result: AcchiResult;
};

// ---------------------------------------------------------------------
// 正式ルール: 決着までのシーケンスを構成する
// ---------------------------------------------------------------------

/** 1 ラウンド (じゃんけん→方向) の演出データ */
export type AcchiSequenceRound = {
  /** プレイヤーのじゃんけんの手 */
  jankenPlayer: JankenHand;
  /** CPU のじゃんけんの手 */
  jankenCpu: JankenHand;
  /** プレイヤー視点のじゃんけん結果 */
  jankenOutcome: JankenOutcome;
  /**
   * このラウンドが「決着ラウンド」か (じゃんけんで決着 = 方向が一致)。
   * あいこ (DRAW) や "釣られなかった" ラウンドは false。
   */
  decided: boolean;
  /** 攻撃側 (じゃんけんの勝者) が指した方向 (あいこ時は null) */
  pointedDirection: AcchiDirection | null;
  /** 守備側 (じゃんけんの敗者) が向いた方向 (あいこ時は null) */
  facedDirection: AcchiDirection | null;
  /** このラウンドの攻撃側 ('PLAYER' | 'CPU' | null=あいこ) */
  attacker: 'PLAYER' | 'CPU' | null;
};

export type AcchiPlayResolution = {
  /** 最終結果 (プレイヤー視点)。正式ルールでは WIN か LOSE のみ */
  result: AcchiResult;
  /** プレイヤーが選んだ「攻撃時に指す方向」(送信された方向) */
  playerDirection: AcchiDirection;
  /** 決着時に CPU が向いた / 指した方向 (UI の横顔表示用) */
  cpuDirection: AcchiDirection;
  /** 決着ラウンドのじゃんけん (主表示用) */
  jankenPlayer: JankenHand;
  jankenCpu: JankenHand;
  jankenOutcome: JankenOutcome;
  /** 設定値 (監査用) */
  setting: AcchiWinSetting;
  /** 全ラウンドの演出シーケンス (やり直しを含む) */
  sequence: AcchiSequenceRound[];
};

/**
 * 1 プレイ (= 決着 1 回) を解決する。
 *
 * @param playerHand      プレイヤーが最初に出した手 (決着ラウンドの手として使用)
 * @param playerDirection プレイヤーが選んだ方向 (攻撃側になったとき指す方向)
 * @param setting         プレイヤーのプランに割り当てられた設定 (1〜6)
 */
export function resolveAcchiPlay(
  playerHand: JankenHand,
  playerDirection: AcchiDirection,
  setting: AcchiWinSetting,
): AcchiPlayResolution {
  const winRate = acchiWinRate(setting);
  const playerWins = randomUnit() < winRate;

  const sequence: AcchiSequenceRound[] = [];

  // --- 演出: 0〜2 回の「やり直しラウンド」をランダムに挟む ---
  // (あいこ or 攻撃側が釣れなかった = decided:false)
  const filler = randomInt(0, 3); // 0,1,2
  for (let i = 0; i < filler; i++) {
    // あいこ or 不一致のどちらか
    if (randomInt(0, 2) === 0) {
      // あいこ
      const hand = pick(JANKEN_HANDS);
      sequence.push({
        jankenPlayer: hand,
        jankenCpu: hand,
        jankenOutcome: 'DRAW',
        decided: false,
        pointedDirection: null,
        facedDirection: null,
        attacker: null,
      });
    } else {
      // じゃんけんはついたが、方向が一致せず決着しなかったラウンド
      const fillerPlayerWins = randomInt(0, 2) === 0;
      const pHand = pick(JANKEN_HANDS);
      const cHand = cpuHandForOutcome(pHand, fillerPlayerWins ? 'WIN' : 'LOSE');
      // 攻撃側が指す方向と守備側が向く方向を「別々」にする (不一致)
      const pointed = pick(ACCHI_DIRECTIONS);
      let faced = pick(ACCHI_DIRECTIONS);
      while (faced === pointed) faced = pick(ACCHI_DIRECTIONS);
      sequence.push({
        jankenPlayer: pHand,
        jankenCpu: cHand,
        jankenOutcome: fillerPlayerWins ? 'WIN' : 'LOSE',
        decided: false,
        pointedDirection: pointed,
        facedDirection: faced,
        attacker: fillerPlayerWins ? 'PLAYER' : 'CPU',
      });
    }
  }

  // --- 決着ラウンド ---
  let jankenPlayer: JankenHand;
  let jankenCpu: JankenHand;
  let jankenOutcome: JankenOutcome;
  let pointed: AcchiDirection;
  let faced: AcchiDirection;
  let attacker: 'PLAYER' | 'CPU';
  let cpuDirection: AcchiDirection;

  if (playerWins) {
    // プレイヤーが攻撃側で勝つ: プレイヤーがじゃんけんに勝ち、指した方向に CPU が向く
    jankenPlayer = playerHand;
    jankenCpu = cpuHandForOutcome(playerHand, 'WIN');
    jankenOutcome = 'WIN';
    pointed = playerDirection; // プレイヤーが指した方向
    faced = playerDirection; // CPU が同じ方向を向いた → プレイヤー勝ち
    attacker = 'PLAYER';
    cpuDirection = faced; // CPU が向いた方向
  } else {
    // プレイヤーが負ける: CPU が攻撃側で、CPU の指した方向にプレイヤーが向いてしまう
    jankenPlayer = playerHand;
    jankenCpu = cpuHandForOutcome(playerHand, 'LOSE');
    jankenOutcome = 'LOSE';
    // CPU が指す方向 == プレイヤーが向いた方向 (= playerDirection) で一致 → プレイヤー負け
    pointed = playerDirection;
    faced = playerDirection;
    attacker = 'CPU';
    cpuDirection = pointed; // CPU が指した方向
  }

  sequence.push({
    jankenPlayer,
    jankenCpu,
    jankenOutcome,
    decided: true,
    pointedDirection: pointed,
    facedDirection: faced,
    attacker,
  });

  return {
    result: playerWins ? 'WIN' : 'LOSE',
    playerDirection,
    cpuDirection,
    jankenPlayer,
    jankenCpu,
    jankenOutcome,
    setting,
    sequence,
  };
}
