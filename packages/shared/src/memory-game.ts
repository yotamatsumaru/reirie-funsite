/**
 * ミニゲーム「神経衰弱 (PUI メモリー)」の純粋ロジック & 定数。
 *
 * カードの絵柄には REIRIE の写真 (ギャラリー) を使い、ペアを揃えると
 * その写真が大きく表示される。「推しの写真を集める」体験にすることで、
 * 単なるパズルではなくファンサイトらしいゲームにしている。
 *
 * ここには副作用のない関数のみを置く (乱数・DB アクセスは含めない)。
 * 盤面の生成はサーバー (apps/web/src/lib/games/memory.ts) が
 * 暗号論的乱数で行い、本モジュールの関数で検証・判定する。
 *
 * ===================================================================
 * 【最重要】既存ミニゲームとの構造的な違い
 * ===================================================================
 *
 * あっち向いてホイ / スロットは «1 リクエスト = 1 プレイ完結» だった。
 * クライアントは「回す」しか送らず、結果はサーバーが即座に確定できた。
 *
 * 神経衰弱は «複数ターンにまたがるセッション» である。ここで素朴に
 * 「盤面を全部クライアントに返す」実装をすると、
 *
 *   - DevTools やレスポンスを見るだけで全カードの位置が分かる
 *   - 1 回もミスせずに全ペアを揃えられる → Pui を稼ぎ放題
 *
 * となり、ゲームとして成立しない。そこで:
 *
 *   1. 盤面 (どの位置にどの写真があるか) は **サーバーの DB のみ** が持つ
 *   2. クライアントには「めくった位置の写真」だけを都度返す
 *   3. 未めくりのカードは常に «裏» としてしか返さない
 *
 * この不変条件を守るため、クライアントへ渡す形 (MemoryCardView) と
 * サーバー内部の盤面 (MemoryBoard) を **別の型** に分けている。
 * 型が同じだと、うっかり盤面をそのまま返すコードが書けてしまうため。
 *
 * ===================================================================
 * 【写真のアクセスレベルについて】
 * ===================================================================
 *
 * カードに使う写真は、プレイヤーのプランで «実際に閲覧できる» ものだけに
 * 限定しなければならない。PREMIUM 限定の写真を無料会員の盤面に混ぜると、
 * ギャラリーで鍵をかけている写真がゲーム経由で見えてしまう
 * (ask#60 で塞いだ穴を、別の入口から開けることになる)。
 * 絞り込みはサーバー側で accessibleLevels() を使って行う。
 */

import { z } from 'zod';

// ---------------------------------------------------------------------
// 定数 (ゲームバランス)
// ---------------------------------------------------------------------

/** 1 日にプレイできる回数の上限 (acchi と同じ 5 回) */
export const MEMORY_MAX_PLAYS_PER_DAY = 5;

/**
 * 盤面のペア数。
 *
 * 8 ペア = 16 枚。スマホの縦画面で 4×4 に収まり、
 * 1 ゲームが 1〜2 分で終わる大きさ。
 * これより増やすと «作業» になり、減らすと運だけで揃ってしまう。
 */
export const MEMORY_PAIR_COUNT = 8;

/** 盤面の総カード枚数 */
export const MEMORY_CARD_COUNT = MEMORY_PAIR_COUNT * 2;

/**
 * クリアと判定される «手数» の上限 (1 手 = 2 枚めくる)。
 *
 * 8 ペアを完全記憶で揃える理論最小手数は 8 手。
 * 上限を 20 手にすると、記憶していれば余裕を持って達成でき、
 * 完全な当てずっぽうではほぼ届かない水準になる。
 * (めくり続けられると «時間をかければ必ず全部揃う» ので、
 *  上限が無いと報酬が実質の «参加賞» になってしまう)
 */
export const MEMORY_MAX_MOVES = 20;

/**
 * 1 ペア揃えるごとに得られる Pui。
 *
 * 全 8 ペア揃えると 8 × 4 = 32 Pui となり、
 * あっち向いてホイの勝利報酬 (ACCHI_WIN_REWARD = 32) と釣り合う。
 * 「1 プレイの上限価値」を既存ゲームと揃えることで、
 * 特定のゲームだけが Pui 稼ぎに有利になるのを防ぐ。
 */
export const MEMORY_PAIR_REWARD = 4;

/**
 * 手数上限内に全ペア揃えた場合のボーナス Pui。
 *
 * ペア報酬の合計 (32) + ボーナス (16) = 最大 48 Pui。
 * 「最後まで揃えきる」動機付けのために置く。
 */
export const MEMORY_CLEAR_BONUS = 16;

/** 1 プレイで得られる Pui の理論上限 (UI 表示・検算用) */
export const MEMORY_MAX_REWARD =
  MEMORY_PAIR_COUNT * MEMORY_PAIR_REWARD + MEMORY_CLEAR_BONUS;

/**
 * セッションの有効期限 (分)。
 *
 * 途中で離脱した盤面をいつまでも残すと、
 * 「1 日 5 回」の枠を消費しないまま盤面だけ溜まる。
 * また、期限を設けないと «有利な盤面を引くまで開き直す» 待機もできる。
 */
export const MEMORY_SESSION_TTL_MINUTES = 30;

// ---------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------

/** カードに使う写真 1 枚 */
export type MemoryPhoto = {
  /** 写真の識別子 (ContentImage.id など) */
  id: string;
  /** 画像 URL */
  url: string;
  /** 写真のキャプション (揃えたときに表示する) */
  caption?: string | null;
};

/**
 * サーバー内部の盤面。**クライアントには絶対に返さない。**
 *
 * cards[i] は位置 i のカードが指す «ペア番号» (0 〜 PAIR_COUNT-1)。
 * ペア番号は photos の添字に対応する。
 */
export type MemoryBoard = {
  /** 位置 → ペア番号 */
  cards: number[];
  /** ペア番号 → 写真 */
  photos: MemoryPhoto[];
};

/**
 * クライアントに見せるカード 1 枚。
 *
 * 未めくり (faceUp=false) のときは photo を持たない。
 * この型に «常に photo がある» ようにしてしまうと盤面が漏れるため、
 * photo は省略可能にしてある。
 */
export type MemoryCardView = {
  /** 盤面上の位置 (0 〜 CARD_COUNT-1) */
  index: number;
  /** 表になっているか (めくり中 or 揃って確定) */
  faceUp: boolean;
  /** ペアが揃って確定したか */
  matched: boolean;
  /** faceUp のときだけ入る写真 */
  photo?: MemoryPhoto;
};

/** 1 手 (2 枚めくり) の判定結果 */
export type MemoryFlipOutcome =
  /** 1 枚目をめくった (まだ判定しない) */
  | 'FIRST'
  /** 2 枚目をめくって一致した */
  | 'MATCH'
  /** 2 枚目をめくって外れた */
  | 'MISS';

/** ゲームの進行状態 */
export type MemoryGameStatus =
  /** プレイ中 */
  | 'PLAYING'
  /** 全ペア揃えた */
  | 'CLEARED'
  /** 手数上限に達して終了 */
  | 'FAILED';

// ---------------------------------------------------------------------
// スキーマ
// ---------------------------------------------------------------------

/**
 * めくるリクエスト。
 *
 * 位置しか受け取らない。「揃った」「報酬は N Pui」などを
 * クライアントから受け取らないことが不正防止の要。
 */
export const memoryFlipSchema = z.object({
  index: z.number().int().min(0).max(MEMORY_CARD_COUNT - 1),
});

export type MemoryFlipInput = z.infer<typeof memoryFlipSchema>;

/**
 * DB に保存する盤面の JSON スキーマ。
 *
 * 保存済みデータを読むときに検証する。壊れた JSON をそのまま
 * 信用すると、めくり判定が undefined 同士の比較になり
 * «常に一致» のような事故が起きうる。
 */
export const memoryBoardSchema = z.object({
  cards: z.array(z.number().int().min(0)),
  photos: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      caption: z.string().nullable().optional(),
    }),
  ),
});

// ---------------------------------------------------------------------
// 判定ロジック (純粋関数)
// ---------------------------------------------------------------------

/**
 * 盤面が «正しく» 組まれているか検証する。
 *
 * 各ペア番号がちょうど 2 枚ずつ存在し、写真の数と一致していること。
 * 生成直後にこれを通してから保存する。ここが崩れると
 * 「絶対に揃わないカード」や「3 枚同じ絵柄」が生まれ、
 * プレイヤーからは «バグで揃わない» としか見えない。
 */
export function isValidMemoryBoard(board: MemoryBoard): boolean {
  const pairCount = board.photos.length;
  if (pairCount === 0) return false;
  if (board.cards.length !== pairCount * 2) return false;

  const counts = new Array<number>(pairCount).fill(0);
  for (const pair of board.cards) {
    if (!Number.isInteger(pair) || pair < 0 || pair >= pairCount) return false;
    counts[pair] = (counts[pair] ?? 0) + 1;
  }
  return counts.every((c) => c === 2);
}

/**
 * 2 枚のカードが同じペアかを判定する。
 *
 * 同じ «位置» を 2 回めくった場合は一致とみなさない
 * (同じカードを 2 回タップして揃えられてしまうため)。
 */
export function isMemoryMatch(
  board: MemoryBoard,
  indexA: number,
  indexB: number,
): boolean {
  if (indexA === indexB) return false;
  const a = board.cards[indexA];
  const b = board.cards[indexB];
  if (a === undefined || b === undefined) return false;
  return a === b;
}

/**
 * そのカードをめくれるか。
 *
 * すでに «確定済み (matched)» か «今めくっている 1 枚目» は
 * めくれない。クライアントの二重タップや、
 * 意図的な不正リクエストの両方をここで弾く。
 */
export function canFlipMemoryCard(
  index: number,
  matchedIndexes: readonly number[],
  firstPick: number | null,
  cardCount = MEMORY_CARD_COUNT,
): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= cardCount) return false;
  if (matchedIndexes.includes(index)) return false;
  if (firstPick === index) return false;
  return true;
}

/**
 * 現在のゲーム状態を判定する。
 *
 * 【判定順序が重要】クリア判定を手数超過より «先» に行う。
 * 最後の 1 手でちょうど上限に達しつつ全ペア揃えた場合、
 * 順序を逆にすると «揃えたのに FAILED» になり、
 * プレイヤーから見て理不尽な結果になる。
 */
export function resolveMemoryStatus(
  matchedPairs: number,
  moves: number,
  pairCount = MEMORY_PAIR_COUNT,
  maxMoves = MEMORY_MAX_MOVES,
): MemoryGameStatus {
  if (matchedPairs >= pairCount) return 'CLEARED';
  if (moves >= maxMoves) return 'FAILED';
  return 'PLAYING';
}

/**
 * 獲得 Pui (プラン倍率適用前のベース値) を計算する。
 *
 * 「揃えたペア数 × ペア報酬」に、全ペア揃えた場合のみボーナスを加える。
 * 途中終了でも揃えたぶんは受け取れるようにしているのは、
 * 手数上限で失敗したときに «完全に無駄» にならないようにするため。
 */
export function memoryReward(
  matchedPairs: number,
  cleared: boolean,
  pairReward = MEMORY_PAIR_REWARD,
  clearBonus = MEMORY_CLEAR_BONUS,
): number {
  const base = Math.max(0, matchedPairs) * pairReward;
  return cleared ? base + clearBonus : base;
}

/** 残りプレイ回数 (負にはならない) */
export function memoryRemainingPlays(
  playedToday: number,
  maxPerDay = MEMORY_MAX_PLAYS_PER_DAY,
): number {
  return Math.max(0, maxPerDay - playedToday);
}

/** 残り手数 (負にはならない) */
export function memoryRemainingMoves(
  moves: number,
  maxMoves = MEMORY_MAX_MOVES,
): number {
  return Math.max(0, maxMoves - moves);
}

/**
 * セッションが期限切れかを判定する。
 */
export function isMemorySessionExpired(
  startedAt: Date,
  now: Date = new Date(),
  ttlMinutes = MEMORY_SESSION_TTL_MINUTES,
): boolean {
  return now.getTime() - startedAt.getTime() > ttlMinutes * 60 * 1000;
}

/**
 * クライアントに返すカード一覧を組み立てる。
 *
 * ★ここが不正防止の最終防壁★
 *
 * 「表になっている位置」以外には photo を入れない。
 * 盤面 (board) を受け取るがそのまま返さず、
 * 表向きのカードだけ写真を差し込んで返す。
 *
 * @param board        サーバー内部の盤面
 * @param matchedIndexes 揃って確定した位置
 * @param faceUpIndexes  いま表になっている位置 (めくり中の 1〜2 枚)
 */
export function buildMemoryCardViews(
  board: MemoryBoard,
  matchedIndexes: readonly number[],
  faceUpIndexes: readonly number[],
): MemoryCardView[] {
  const matched = new Set(matchedIndexes);
  const faceUp = new Set([...matchedIndexes, ...faceUpIndexes]);

  return board.cards.map((pair, index) => {
    const isFaceUp = faceUp.has(index);
    const view: MemoryCardView = {
      index,
      faceUp: isFaceUp,
      matched: matched.has(index),
    };
    if (isFaceUp) {
      const photo = board.photos[pair];
      // 盤面が壊れている場合でも undefined を入れない
      // (クライアントで写真無しのカードとして描画される)
      if (photo) view.photo = photo;
    }
    return view;
  });
}

/**
 * 盤面から «見えてはいけない情報» が漏れていないか検査する。
 *
 * buildMemoryCardViews の結果を通し、
 * 表向きでないカードに写真が入っていれば false。
 * テストおよび API のレスポンス直前チェックで使い、
 * 将来の改修で盤面が漏れる事故を検出する。
 */
export function isSafeMemoryCardViews(views: MemoryCardView[]): boolean {
  return views.every((v) => (v.faceUp ? true : v.photo === undefined));
}
