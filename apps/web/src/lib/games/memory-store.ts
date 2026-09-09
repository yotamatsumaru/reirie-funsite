/**
 * 神経衰弱 — セッションの永続化と Pui 付与。
 *
 * ここが「盤面を DB にだけ置き、クライアントには見せない」実装の中心。
 *
 * ===================================================================
 * 【なぜ points.ts に置かず別ファイルにしたか】
 * ===================================================================
 *
 * points.ts は acchi / slot の «1 リクエスト完結» 型の処理に最適化されており、
 * 神経衰弱はセッションのライフサイクル (開始 → めくり × N → 終了) を持つ。
 * 混ぜると points.ts がさらに肥大化して読めなくなるため、
 * Pui 付与だけ points.ts の仕組み (applyPui / advisory lock) を再利用し、
 * セッション管理はここに閉じる。
 *
 * ===================================================================
 * 【Pui はいつ付与するか — 重要な設計判断】
 * ===================================================================
 *
 * ペアを揃えるたびに少しずつ付与する方式は採らない。
 *
 *   - 途中でブラウザを閉じる / 通信が切れると付与が中途半端になり、
 *     «何 Pui もらえたのか» がユーザーにも運営にも分からなくなる
 *   - めくるたびに Pui 残高を更新すると、1 プレイで最大 8 回の
 *     金銭的トランザクションが走り、監査ログが読みにくくなる
 *
 * そこで **ゲーム終了時 (クリア or 手数上限) に 1 回だけ** 付与する。
 * MiniGamePlay も終了時に 1 行だけ作る。
 *
 * ただし「1 日のプレイ回数」は **開始時** に消費する。
 * 終了時に数えると、開始 → 有利でなければ閉じる → 再開始 を
 * 繰り返して回数無制限にプレイできてしまう。
 */
import { prisma } from '@idol/db';
import {
  jstDateKey,
  MEMORY_MAX_PLAYS_PER_DAY,
  MEMORY_PAIR_COUNT,
  MEMORY_MAX_MOVES,
  memoryRemainingPlays,
  memoryReward,
  memoryBoardSchema,
  isValidMemoryBoard,
  type MemoryBoard,
} from '@idol/shared';

/** 本日プレイした回数 (JST 基準)。終了済みプレイ + 進行中セッション。 */
export async function getMemoryPlayCountToday(
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const date = jstDateKey(now);

  /**
   * 【なぜ進行中セッションも数えるか】
   * MiniGamePlay は «終了時» に作られる。完了済みだけを数えると、
   * 開始しただけで放置したプレイが回数に含まれず、
   * 「開始 → 閉じる」を繰り返して無制限にプレイできてしまう。
   */
  const [finished, active] = await Promise.all([
    prisma.miniGamePlay.count({ where: { userId, gameType: 'MEMORY', date } }),
    prisma.memoryGameSession.count({ where: { userId, date } }),
  ]);
  return finished + active;
}

/** 進行中セッションの読み出し結果 */
export type MemorySessionRecord = {
  id: string;
  board: MemoryBoard;
  matchedIndexes: number[];
  firstPick: number | null;
  moves: number;
  startedAt: Date;
  date: string;
};

/**
 * 保存された盤面 JSON を安全に読む。
 *
 * 壊れた JSON をそのまま信用すると、めくり判定が
 * undefined 同士の比較になり «常に一致» のような事故になる。
 * 壊れていれば null を返し、呼び出し側でセッションを破棄させる。
 */
function parseBoard(raw: string): MemoryBoard | null {
  try {
    const parsed = memoryBoardSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const board: MemoryBoard = {
      cards: parsed.data.cards,
      photos: parsed.data.photos.map((p) => ({
        id: p.id,
        url: p.url,
        caption: p.caption ?? null,
      })),
    };
    return isValidMemoryBoard(board) ? board : null;
  } catch {
    return null;
  }
}

/** 揃った位置の配列を安全に読む */
function parseMatched(raw: string): number[] {
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((n): n is number => Number.isInteger(n) && n >= 0);
  } catch {
    return [];
  }
}

/** 進行中のセッションを取得する (無い / 壊れている場合は null) */
export async function getMemorySession(
  userId: string,
): Promise<MemorySessionRecord | null> {
  const row = await prisma.memoryGameSession.findUnique({ where: { userId } });
  if (!row) return null;

  const board = parseBoard(row.board);
  if (!board) {
    // 壊れたセッションは残しておくと «何をしても進まない» 状態になるため破棄する。
    await prisma.memoryGameSession.delete({ where: { userId } }).catch(() => undefined);
    return null;
  }

  return {
    id: row.id,
    board,
    matchedIndexes: parseMatched(row.matchedIndexes),
    firstPick: row.firstPick,
    moves: row.moves,
    startedAt: row.startedAt,
    date: row.date,
  };
}

/** セッション開始の結果 */
export type StartMemorySessionResult =
  | { ok: true; session: MemorySessionRecord; playedToday: number; remaining: number }
  | { ok: false; reason: 'LIMIT_REACHED'; playedToday: number; remaining: number };

/**
 * 新しいセッションを開始する。
 *
 * 1 日の回数上限をここで消費する (上のコメント参照)。
 * 既存のセッションがある場合は上書きする — 呼び出し側が
 * 「再開ではなく新規開始」と判断したときにだけ呼ぶこと。
 *
 * @param board 生成済みの盤面 (写真の絞り込みは呼び出し側の責務)
 */
export async function startMemorySession(
  userId: string,
  board: MemoryBoard,
  opts?: { unlimited?: boolean },
  now: Date = new Date(),
): Promise<StartMemorySessionResult> {
  const date = jstDateKey(now);
  const unlimited = opts?.unlimited ?? false;

  return prisma.$transaction(async (tx) => {
    /**
     * 【競合対策】同時に 2 回「開始」を叩かれると、
     * 上限チェックをすり抜けて 2 セッション作られる恐れがある。
     * userId に unique があるため片方は失敗するが、
     * 回数の二重消費を避けるため直列化する。
     */
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memory:${userId}`}))`;

    const [finished, existing] = await Promise.all([
      tx.miniGamePlay.count({ where: { userId, gameType: 'MEMORY', date } }),
      tx.memoryGameSession.findUnique({ where: { userId } }),
    ]);

    // 進行中セッションを «作り直す» 場合、そのぶんは既に回数を
    // 消費済みなので二重に数えない。
    const playedBefore = finished + (existing ? 1 : 0);

    if (!unlimited && !existing && playedBefore >= MEMORY_MAX_PLAYS_PER_DAY) {
      return {
        ok: false as const,
        reason: 'LIMIT_REACHED' as const,
        playedToday: playedBefore,
        remaining: 0,
      };
    }

    const boardJson = JSON.stringify(board);
    const row = await tx.memoryGameSession.upsert({
      where: { userId },
      create: {
        userId,
        board: boardJson,
        matchedIndexes: '[]',
        firstPick: null,
        moves: 0,
        counted: true,
        date,
      },
      update: {
        board: boardJson,
        matchedIndexes: '[]',
        firstPick: null,
        moves: 0,
        counted: true,
        date,
        startedAt: now,
      },
    });

    const playedToday = existing ? playedBefore : playedBefore + 1;
    return {
      ok: true as const,
      session: {
        id: row.id,
        board,
        matchedIndexes: [],
        firstPick: null,
        moves: 0,
        startedAt: row.startedAt,
        date: row.date,
      },
      playedToday,
      remaining: unlimited
        ? MEMORY_MAX_PLAYS_PER_DAY
        : memoryRemainingPlays(playedToday),
    };
  });
}

/** セッションの進行状態を更新する (めくり中 / 揃った位置 / 手数) */
export async function updateMemorySession(
  userId: string,
  patch: { matchedIndexes?: number[]; firstPick?: number | null; moves?: number },
): Promise<void> {
  await prisma.memoryGameSession.update({
    where: { userId },
    data: {
      ...(patch.matchedIndexes !== undefined
        ? { matchedIndexes: JSON.stringify(patch.matchedIndexes) }
        : {}),
      ...(patch.firstPick !== undefined ? { firstPick: patch.firstPick } : {}),
      ...(patch.moves !== undefined ? { moves: patch.moves } : {}),
    },
  });
}

/** ゲーム終了処理の結果 */
export type FinishMemoryGameResult = {
  /** 実際に付与された Pui (プラン倍率適用後) */
  reward: number;
  /** 付与後の残高 */
  balance: number;
  playedToday: number;
  remaining: number;
};

/**
 * ゲームを終了し、Pui を付与してセッションを削除する。
 *
 * 【二重付与の防止】
 * セッション行の削除と Pui 付与を同一トランザクションで行い、
 * かつ «削除できた場合のみ» 付与する。
 * 同時に 2 回終了リクエストが来ても、行を消せた側だけが付与される。
 */
export async function finishMemoryGame(
  userId: string,
  matchedPairs: number,
  cleared: boolean,
  detail: string,
  now: Date = new Date(),
): Promise<FinishMemoryGameResult> {
  const date = jstDateKey(now);
  const basePayout = memoryReward(matchedPairs, cleared);

  // applyPui / プラン倍率は points.ts の仕組みを再利用する。
  const { recordMemoryPlay } = await import('@/lib/points');
  return recordMemoryPlay(userId, cleared, basePayout, detail, date, now);
}

/**
 * 期限切れセッションを掃除する。
 *
 * 放置された盤面が残り続けると「1 日 5 回」の枠を
 * 消費したままになり、翌日以降も回数が戻らない。
 * (date が変われば回数判定には影響しないが、
 *  ゴミ行が溜まるのを防ぐ意味でも消しておく)
 */
export async function cleanupExpiredMemorySessions(
  olderThan: Date,
): Promise<number> {
  const res = await prisma.memoryGameSession.deleteMany({
    where: { startedAt: { lt: olderThan } },
  });
  return res.count;
}

/** UI 表示用の定数まとめ (クライアントにハードコードさせない) */
export const MEMORY_RULES = {
  pairCount: MEMORY_PAIR_COUNT,
  maxMoves: MEMORY_MAX_MOVES,
  maxPlaysPerDay: MEMORY_MAX_PLAYS_PER_DAY,
} as const;
