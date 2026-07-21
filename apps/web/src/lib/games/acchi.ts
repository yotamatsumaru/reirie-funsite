/**
 * あっち向いてホイ — サーバー側の権威ある進行ロジック。
 *
 * クライアントは「方向」しか送らない。CPU の方向・勝敗はここ (サーバー) で
 * 暗号論的乱数を用いて生成・確定する。結果やポイントをクライアントから
 * 受け取らないことで、不正なポイント獲得を構造的に不可能にする。
 *
 * === ルール (方向対決 1 ラウンドのみ) ===
 *  - プレイヤーが指した方向と CPU が向いた方向が一致すればプレイヤーの勝ち、
 *    不一致であれば負け。
 *  - 「一致するかどうか」自体は、プレイヤーのプランに割り当てられた
 *    設定 (1〜6) の勝率 (acchiWinRate) で抽選する。CPU の方向はこの
 *    抽選結果に整合するよう構成する (勝率は設定どおり厳密に制御される)。
 */
import { randomInt } from 'node:crypto';
import {
  judgeAcchiResult,
  ACCHI_DIRECTIONS,
  acchiWinRate,
  type AcchiDirection,
  type AcchiResult,
  type AcchiWinSetting,
} from '@idol/shared';

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

/** 方向対決の結果。 */
export type AcchiDirectionResult = {
  player: AcchiDirection;
  cpu: AcchiDirection;
  matched: boolean;
  setting: AcchiWinSetting;
};

export type AcchiPlayResolution = {
  result: AcchiResult;
  direction: AcchiDirectionResult;
};

/**
 * 勝率抽選の結果 (matched) から、それに整合する CPU の方向を構成して
 * 方向対決の結果オブジェクトを組み立てる純粋関数。
 */
export function buildDirectionResult(
  playerDirection: AcchiDirection,
  matched: boolean,
  setting: AcchiWinSetting,
): AcchiDirectionResult {
  const cpu = matched ? playerDirection : pickMismatchedDirection(playerDirection);
  return { player: playerDirection, cpu, matched, setting };
}

/**
 * 設定 (1〜6) の勝率に従って「方向対決に勝つか (matched)」だけを抽選する。
 */
export function rollDirectionMatched(setting: AcchiWinSetting): boolean {
  return randomUnit() < acchiWinRate(setting);
}

/**
 * 方向対決を、設定 (1〜6) の勝率に従って解決する。
 * 一致/不一致の抽選結果に整合する CPU の方向を構成する。
 */
function resolveDirection(
  playerDirection: AcchiDirection,
  setting: AcchiWinSetting,
): AcchiDirectionResult {
  const matched = rollDirectionMatched(setting);
  return buildDirectionResult(playerDirection, matched, setting);
}

/**
 * 1 プレイを解決する (方向対決 1 ラウンドのみ)。
 */
export function resolveAcchiPlay(
  playerDirection: AcchiDirection,
  setting: AcchiWinSetting,
): AcchiPlayResolution {
  const direction = resolveDirection(playerDirection, setting);
  const result = judgeAcchiResult(direction.matched);
  return { result, direction };
}
