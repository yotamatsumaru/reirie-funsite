/**
 * スロット — サーバー側の権威ある抽選ロジック。
 *
 * クライアントは「回す」というリクエストしか送らない。役の抽選・リールの停止絵柄・
 * 獲得 Pui はすべてここ (サーバー) で暗号論的乱数を用いて確定する。
 * 結果や獲得ポイントをクライアントから受け取らないことで、不正な Pui 獲得を
 * 構造的に不可能にしている (あっち向いてホイ = acchi.ts と同じ方針)。
 *
 * === 処理の順序 ===
 *  1. プレイヤーのプランに割り当てられた設定 (1〜6) の確率テーブルで「役」を抽選する
 *  2. その役に整合するリール絵柄 (3 つ) を構成する
 *  3. 構成した絵柄が本当に役と一致しているか自己検証してから返す
 *
 * この順序にする理由は packages/shared/src/slot-game.ts の冒頭コメント参照
 * (出玉率を設定で厳密に制御できるようにするため)。
 */
import { randomInt } from 'node:crypto';
import {
  SLOT_SYMBOLS,
  SLOT_TRIPLE_SYMBOL,
  reelsMatchOutcome,
  rollSlotOutcome,
  slotPayout,
  type SlotOutcome,
  type SlotReels,
  type SlotSetting,
  type SlotSymbol,
} from '@idol/shared';

/** [0,1) の暗号論的乱数 */
function randomUnit(): number {
  return randomInt(0, 0x100000000) / 0x100000000;
}

/** 配列から暗号論的乱数で 1 つ選ぶ */
function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(arr.length)];
}

/** チェリー以外の絵柄 (はずれ / チェリー小役のダミー絵柄用) */
const NON_CHERRY_SYMBOLS: readonly SlotSymbol[] = SLOT_SYMBOLS.filter((s) => s !== 'CHERRY');

/**
 * 「3 つ揃いになっていない」チェリー以外の 2 絵柄を作る。
 * (はずれの見た目を作るときに使う。3 つ揃いにならないよう必ず異なる絵柄にする)
 */
function pickTwoDistinctNonCherry(): [SlotSymbol, SlotSymbol] {
  const first = pick(NON_CHERRY_SYMBOLS);
  const rest = NON_CHERRY_SYMBOLS.filter((s) => s !== first);
  return [first, pick(rest)];
}

/** 配列を暗号論的乱数でシャッフルする (Fisher-Yates) */
function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 抽選で決まった役に整合する、リールの停止絵柄を構成する。
 *
 *  - 3 つ揃い役   … その絵柄を 3 つ並べる
 *  - CHERRY_SINGLE… チェリーを 1 つ含め、残りは「3 つ揃いにならない」別絵柄にする
 *  - LOSE         … チェリーを含まず、かつ 3 つ揃いにもならない絵柄にする
 *
 * 位置はシャッフルするので、チェリーが左/中/右のどこに止まるかは毎回変わる
 * (見た目の自然さのため。役の判定には位置は影響しない)。
 */
export function buildReelsForOutcome(outcome: SlotOutcome): SlotReels {
  if (outcome === 'CHERRY_SINGLE') {
    // チェリー 1 つ + 3 つ揃いにならない別絵柄 2 つ。
    const [a, b] = pickTwoDistinctNonCherry();
    const shuffled = shuffle<SlotSymbol>(['CHERRY', a, b]);
    return [shuffled[0], shuffled[1], shuffled[2]] as SlotReels;
  }

  if (outcome === 'LOSE') {
    // チェリー無し・3 つ揃い無し。
    // 「2 つだけ同じ」(いわゆるテンパイ外し) は許容する — 見た目に緊張感が出るため。
    const [a, b] = pickTwoDistinctNonCherry();
    // 3 枚目は a か b のどちらか (= 必ず 2 種類以上になるので 3 つ揃いにはならない)。
    const third = pick([a, b]);
    const shuffled = shuffle<SlotSymbol>([a, b, third]);
    return [shuffled[0], shuffled[1], shuffled[2]] as SlotReels;
  }

  // 3 つ揃い役
  const symbol = SLOT_TRIPLE_SYMBOL[outcome];
  return [symbol, symbol, symbol];
}

/** 1 プレイの解決結果 */
export type SlotPlayResolution = {
  /** 抽選で決まった役 */
  outcome: SlotOutcome;
  /** 役に整合する停止絵柄 (左・中・右) */
  reels: SlotReels;
  /** 獲得 Pui (ベース値・プラン倍率適用前) */
  payout: number;
  /** 使用された設定 (1〜6)。監査ログ用。 */
  setting: SlotSetting;
};

/**
 * 1 プレイを解決する。
 *
 * @param setting プレイヤーのプランに割り当てられた設定 (1〜6)
 */
export function resolveSlotPlay(setting: SlotSetting): SlotPlayResolution {
  const outcome = rollSlotOutcome(randomUnit(), setting);
  const reels = buildReelsForOutcome(outcome);

  // 【自己検証】絵柄の構成にバグがあると「はずれなのに 7 が 3 つ並ぶ」等、
  // プレイヤーから不正に見える表示になる。ここで必ず検証し、万一矛盾したら
  // 安全側 (はずれの見た目) にフォールバックする。
  if (!reelsMatchOutcome(reels, outcome)) {
    console.error('[slot] reels/outcome mismatch (falling back)', { outcome, reels });
    const fallback = buildReelsForOutcome('LOSE');
    return { outcome: 'LOSE', reels: fallback, payout: 0, setting };
  }

  return { outcome, reels, payout: slotPayout(outcome), setting };
}
