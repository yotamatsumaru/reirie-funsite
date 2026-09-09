/**
 * 神経衰弱 (PUI メモリー) API の共通ハンドラ実装。
 *
 * `/api/me/games/memory` (Web) と `/api/v1/games/memory` (ネイティブ向け) が
 * 同じロジックを共有する (acchi-handlers / slot-handlers と同じ構成)。
 *
 * ===================================================================
 * 【セキュリティ上の不変条件】
 * ===================================================================
 *
 *  1. 盤面 (どの位置にどの写真か) は **絶対にレスポンスへ入れない**。
 *     クライアントに返すのは buildMemoryCardViews の結果だけで、
 *     未めくりカードには写真を含めない。
 *     返す直前に isSafeMemoryCardViews で検査し、漏れていれば
 *     500 で止める (静かに漏らすより落とす)。
 *
 *  2. クライアントは「この位置をめくる」しか送らない。
 *     揃ったかどうか・獲得 Pui はすべてサーバーが決める。
 *
 *  3. 写真はプレイヤーのプランで閲覧できるものだけを使う。
 *     PREMIUM 限定ギャラリーの写真を無料会員の盤面に混ぜると、
 *     鍵をかけた写真がゲーム経由で見えてしまう。
 *
 *  4. 1 日の回数上限は «開始時» に消費する。
 *     終了時に数えると「開始 → 閉じる → 再開始」で無制限に遊べる。
 *
 *  5. ゲーム非公開中 (公開トグル) は GET も含めて 404。
 *     ページだけ隠しても API が生きていると直接叩けてしまう。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import {
  jstDateKey,
  buildMemoryCardViews,
  canFlipMemoryCard,
  isMemoryMatch,
  isMemorySessionExpired,
  isSafeMemoryCardViews,
  memoryFlipSchema,
  memoryRemainingMoves,
  memoryRemainingPlays,
  memoryReward,
  resolveMemoryStatus,
  MEMORY_CLEAR_BONUS,
  MEMORY_MAX_MOVES,
  MEMORY_MAX_PLAYS_PER_DAY,
  MEMORY_MAX_REWARD,
  MEMORY_PAIR_COUNT,
  MEMORY_PAIR_REWARD,
  isPromoActive,
  PROMO_EFFECTIVE_PLAN,
  type MemoryCardView,
  type MemoryGameStatus,
  type PlanTypeLiteral,
} from '@idol/shared';
import { errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { requireApiPrincipal } from '@/lib/api-auth';
import { safeGetPromoUntil, PROMO_UNLIMITED_REMAINING } from '@/lib/points';
import { requireGameVisible } from '@/lib/game-visibility';
import { createMemoryBoardForPlan } from '@/lib/games/memory';
import {
  finishMemoryGame,
  getMemoryPlayCountToday,
  getMemorySession,
  startMemorySession,
  updateMemorySession,
  type MemorySessionRecord,
} from '@/lib/games/memory-store';

/**
 * ユーザーの現在プランを DB の有効サブスクリプションから解決する。
 * (JWT の plan は古い場合があるため、写真の絞り込みはサーバーで再解決する)
 */
async function resolveUserPlan(userId: string): Promise<PlanTypeLiteral> {
  const [promoUntil, sub] = await Promise.all([
    safeGetPromoUntil(prisma, userId),
    prisma.subscription.findFirst({
      where: { userId, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
      orderBy: { createdAt: 'desc' },
      select: { planType: true },
    }),
  ]);
  if (isPromoActive(promoUntil)) return PROMO_EFFECTIVE_PLAN;
  return (sub?.planType as PlanTypeLiteral | undefined) ?? 'FREE';
}

/** ルール定数 (クライアントにハードコードさせない) */
const RULES = {
  pairCount: MEMORY_PAIR_COUNT,
  maxMoves: MEMORY_MAX_MOVES,
  maxPlaysPerDay: MEMORY_MAX_PLAYS_PER_DAY,
  pairReward: MEMORY_PAIR_REWARD,
  clearBonus: MEMORY_CLEAR_BONUS,
  maxReward: MEMORY_MAX_REWARD,
} as const;

/**
 * カード一覧を組み立て、盤面が漏れていないか検査してから返す。
 *
 * ★ここを通さずにカードを返してはいけない★
 */
function safeCardViews(
  session: MemorySessionRecord,
  faceUpIndexes: number[],
): MemoryCardView[] {
  const views = buildMemoryCardViews(
    session.board,
    session.matchedIndexes,
    faceUpIndexes,
  );
  if (!isSafeMemoryCardViews(views)) {
    // 実装ミスで盤面が漏れる状態。静かに漏らすより落とす。
    throw errors.internal('内部エラー: 盤面の整合性チェックに失敗しました');
  }
  return views;
}

/** 進行中セッションのレスポンスを作る */
function sessionResponse(
  session: MemorySessionRecord,
  extra: Record<string, unknown> = {},
) {
  const faceUp = session.firstPick === null ? [] : [session.firstPick];
  const matchedPairs = session.matchedIndexes.length / 2;
  return {
    inProgress: true,
    status: resolveMemoryStatus(matchedPairs, session.moves) as MemoryGameStatus,
    cards: safeCardViews(session, faceUp),
    matchedPairs,
    moves: session.moves,
    remainingMoves: memoryRemainingMoves(session.moves),
    // いま 1 枚めくっている状態か (UI が 2 枚目を待つ判断に使う)
    awaitingSecond: session.firstPick !== null,
    rules: RULES,
    ...extra,
  };
}

/**
 * GET /api/{me,v1}/games/memory
 *   — 本日の残り回数・残高・進行中セッション (あれば) を返す。
 */
export async function handleMemoryGet(req: Request): Promise<Response> {
  await requireGameVisible(req, 'memory');
  const principal = await requireApiPrincipal(req);

  const [playedToday, user, promoUntil, session] = await Promise.all([
    getMemoryPlayCountToday(principal.userId),
    prisma.user.findUnique({
      where: { id: principal.userId },
      select: { pui: true },
    }),
    safeGetPromoUntil(prisma, principal.userId),
    getMemorySession(principal.userId),
  ]);

  const promoActive = isPromoActive(promoUntil);

  // 期限切れのセッションは «無い» ものとして扱う。
  const alive = session && !isMemorySessionExpired(session.startedAt) ? session : null;

  return NextResponse.json({
    date: jstDateKey(),
    promoActive,
    maxPerDay: MEMORY_MAX_PLAYS_PER_DAY,
    playedToday,
    remaining: promoActive
      ? PROMO_UNLIMITED_REMAINING
      : memoryRemainingPlays(playedToday),
    balance: user?.pui ?? 0,
    // sessionResponse も rules を含むため、スプレッドの «後» に置いて
    // 常に同じ内容が入るようにする (先に置くと上書きされて警告になる)。
    ...(alive
      ? sessionResponse(alive)
      : { inProgress: false, status: 'PLAYING' as MemoryGameStatus, cards: [] }),
    rules: RULES,
  });
}

/**
 * POST /api/{me,v1}/games/memory/start — 新しい盤面を開始する。
 *
 * 進行中セッションがある場合はそれを返す (作り直さない)。
 * 作り直せてしまうと、揃えたペアをリセットして
 * 有利な盤面を引き直せてしまうため。
 */
export async function handleMemoryStart(req: Request): Promise<Response> {
  await requireGameVisible(req, 'memory');
  const principal = await requireApiPrincipal(req);

  // 進行中で期限内のセッションがあればそれを継続する。
  const existing = await getMemorySession(principal.userId);
  if (existing && !isMemorySessionExpired(existing.startedAt)) {
    return NextResponse.json({
      ...sessionResponse(existing),
      resumed: true,
    });
  }

  const [plan, promoUntil] = await Promise.all([
    resolveUserPlan(principal.userId),
    safeGetPromoUntil(prisma, principal.userId),
  ]);
  const promoActive = isPromoActive(promoUntil);

  // ★写真はプレイヤーのプランで閲覧できるものだけ★
  const built = await createMemoryBoardForPlan(plan);
  if (!built.ok) {
    /**
     * 写真が足りない場合。足りないぶんを同じ写真で埋めると
     * «見た目が同じで別ペア» のカードが生まれ、
     * プレイヤーには «揃わないバグ» としか見えない。
     * 理由を明示して開始を断る。
     */
    throw errors.unprocessable(
      `ゲームに使える写真が足りません (${built.available}枚 / 必要 ${built.required}枚)。ギャラリーに写真が追加されると遊べるようになります`,
    );
  }

  const started = await startMemorySession(
    principal.userId,
    built.board,
    { unlimited: promoActive },
  );

  if (!started.ok) {
    throw errors.rateLimited(
      '本日のプレイ回数の上限に達しました。明日また挑戦してください',
    );
  }

  return NextResponse.json({
    ...sessionResponse(started.session),
    resumed: false,
    playedToday: started.playedToday,
    remaining: promoActive ? PROMO_UNLIMITED_REMAINING : started.remaining,
  });
}

/**
 * POST /api/{me,v1}/games/memory/flip — カードを 1 枚めくる。
 *
 * リクエストは位置のみ。判定・報酬はすべてサーバーが決める。
 */
export async function handleMemoryFlip(req: Request): Promise<Response> {
  await requireGameVisible(req, 'memory');
  const principal = await requireApiPrincipal(req);

  const body: unknown = await req.json().catch(() => null);
  const parsed = memoryFlipSchema.safeParse(body);
  if (!parsed.success) {
    throw errors.badRequest('めくる位置の指定が正しくありません');
  }
  const { index } = parsed.data;

  const session = await getMemorySession(principal.userId);
  if (!session) {
    throw errors.notFound('進行中のゲームがありません。新しく始めてください');
  }
  if (isMemorySessionExpired(session.startedAt)) {
    throw errors.unprocessable(
      'ゲームの有効期限が切れました。新しく始めてください',
    );
  }

  // すでに終了状態のセッションを操作させない
  const currentPairs = session.matchedIndexes.length / 2;
  const currentStatus = resolveMemoryStatus(currentPairs, session.moves);
  if (currentStatus !== 'PLAYING') {
    throw errors.unprocessable('このゲームは既に終了しています');
  }

  // めくれない位置 (確定済み / 1 枚目と同じ / 範囲外) を弾く
  if (!canFlipMemoryCard(index, session.matchedIndexes, session.firstPick)) {
    throw errors.badRequest('そのカードはめくれません');
  }

  // ---------------- 1 枚目 ----------------
  if (session.firstPick === null) {
    await updateMemorySession(principal.userId, { firstPick: index });
    const next: MemorySessionRecord = { ...session, firstPick: index };
    return NextResponse.json({
      outcome: 'FIRST' as const,
      ...sessionResponse(next),
    });
  }

  // ---------------- 2 枚目 ----------------
  const first = session.firstPick;
  const matched = isMemoryMatch(session.board, first, index);
  const moves = session.moves + 1;

  const matchedIndexes = matched
    ? [...session.matchedIndexes, first, index]
    : session.matchedIndexes;
  const matchedPairs = matchedIndexes.length / 2;
  const status = resolveMemoryStatus(matchedPairs, moves);

  // 揃わなかった場合も «2 枚を見せた状態» を返す必要がある
  // (どのカードだったか分からないと記憶ゲームにならない)。
  // ただし DB 上の firstPick は null に戻す。
  const faceUpForResponse = matched ? [] : [first, index];

  if (status === 'PLAYING') {
    await updateMemorySession(principal.userId, {
      matchedIndexes,
      firstPick: null,
      moves,
    });
    const next: MemorySessionRecord = {
      ...session,
      matchedIndexes,
      firstPick: null,
      moves,
    };
    return NextResponse.json({
      outcome: matched ? ('MATCH' as const) : ('MISS' as const),
      // 外れた 2 枚も今回だけ表で返す (クライアントが一定時間表示して裏returnする)
      cards: safeCardViews(next, faceUpForResponse),
      revealed: faceUpForResponse,
      inProgress: true,
      status,
      matchedPairs,
      moves,
      remainingMoves: memoryRemainingMoves(moves),
      awaitingSecond: false,
      rules: RULES,
    });
  }

  // ---------------- ゲーム終了 ----------------
  const cleared = status === 'CLEARED';
  const detail = JSON.stringify({
    matchedPairs,
    moves,
    cleared,
    basePayout: memoryReward(matchedPairs, cleared),
    photoIds: session.board.photos.map((p) => p.id),
  });

  // 終了時の表示用に、最後の 2 枚を含めたカードを先に作る
  // (finishMemoryGame でセッションが消えるため)
  const finalSession: MemorySessionRecord = {
    ...session,
    matchedIndexes,
    firstPick: null,
    moves,
  };
  const finalCards = safeCardViews(finalSession, faceUpForResponse);

  const finished = await finishMemoryGame(
    principal.userId,
    matchedPairs,
    cleared,
    detail,
  );

  if (finished.reward > 0) {
    await logAudit({
      userId: principal.userId,
      action: 'points.game_reward',
      resource: `user:${principal.userId}`,
      metadata: {
        game: 'MEMORY',
        amount: finished.reward,
        result: cleared ? 'CLEARED' : 'FAILED',
        matchedPairs,
        moves,
        via: principal.source,
      },
    });
  }

  return NextResponse.json({
    outcome: matched ? ('MATCH' as const) : ('MISS' as const),
    cards: finalCards,
    revealed: faceUpForResponse,
    inProgress: false,
    status,
    matchedPairs,
    moves,
    remainingMoves: memoryRemainingMoves(moves),
    awaitingSecond: false,
    reward: finished.reward,
    balance: finished.balance,
    playedToday: finished.playedToday,
    remaining: finished.remaining,
    rules: RULES,
  });
}

/**
 * POST /api/{me,v1}/games/memory/giveup — 途中でやめる。
 *
 * 揃えたぶんの Pui は受け取れる。
 * «やめる» を用意しないと、手数を使い切るまで
 * 無意味なめくりを強制されることになる。
 */
export async function handleMemoryGiveUp(req: Request): Promise<Response> {
  await requireGameVisible(req, 'memory');
  const principal = await requireApiPrincipal(req);

  const session = await getMemorySession(principal.userId);
  if (!session) {
    throw errors.notFound('進行中のゲームがありません');
  }

  const matchedPairs = session.matchedIndexes.length / 2;
  const cleared = matchedPairs >= MEMORY_PAIR_COUNT;
  const detail = JSON.stringify({
    matchedPairs,
    moves: session.moves,
    cleared,
    gaveUp: true,
    basePayout: memoryReward(matchedPairs, cleared),
  });

  const finished = await finishMemoryGame(
    principal.userId,
    matchedPairs,
    cleared,
    detail,
  );

  if (finished.reward > 0) {
    await logAudit({
      userId: principal.userId,
      action: 'points.game_reward',
      resource: `user:${principal.userId}`,
      metadata: {
        game: 'MEMORY',
        amount: finished.reward,
        result: 'GAVE_UP',
        matchedPairs,
        moves: session.moves,
        via: principal.source,
      },
    });
  }

  return NextResponse.json({
    inProgress: false,
    status: (cleared ? 'CLEARED' : 'FAILED') as MemoryGameStatus,
    matchedPairs,
    moves: session.moves,
    reward: finished.reward,
    balance: finished.balance,
    playedToday: finished.playedToday,
    remaining: finished.remaining,
    rules: RULES,
  });
}
