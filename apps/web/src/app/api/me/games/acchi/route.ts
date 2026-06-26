/**
 * あっち向いてホイ ミニゲーム API
 *
 * GET  /api/me/games/acchi  — 本日の残りプレイ回数 & 残高を取得
 * POST /api/me/games/acchi  — 1 プレイを実行 (じゃんけん + 方向を送信、結果はサーバーが確定)
 *
 * セキュリティ:
 *  - CPU の手 / 方向 / 勝敗はすべてサーバーで生成・確定 (クライアントの結果は信用しない)。
 *  - 1 日の回数上限・ポイント付与はトランザクション内で原子的に処理 (cluster でも安全)。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import {
  jstDateKey,
  remainingPlays,
  isJankenHand,
  isAcchiDirection,
  ACCHI_MAX_PLAYS_PER_DAY,
  ACCHI_WIN_REWARD,
} from '@idol/shared';
import { requireSession } from '@/auth';
import { handle, errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getAcchiPlayCountToday, recordAcchiPlay } from '@/lib/points';
import { resolveAcchiRound } from '@/lib/games/acchi';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  const session = await requireSession();
  const [playedToday, user] = await Promise.all([
    getAcchiPlayCountToday(session.user.id),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { points: true },
    }),
  ]);
  return NextResponse.json({
    date: jstDateKey(),
    maxPerDay: ACCHI_MAX_PLAYS_PER_DAY,
    winReward: ACCHI_WIN_REWARD,
    playedToday,
    remaining: remainingPlays(playedToday),
    balance: user?.points ?? 0,
  });
});

export const POST = handle(async (req: Request) => {
  const session = await requireSession();

  const body = (await req.json().catch(() => null)) as
    | { hand?: unknown; direction?: unknown }
    | null;
  if (!body || !isJankenHand(body.hand) || !isAcchiDirection(body.direction)) {
    throw errors.badRequest('手と方向を正しく指定してください');
  }

  // サーバー側で CPU の手・方向・勝敗を確定する
  const round = resolveAcchiRound(body.hand, body.direction);

  const detail = JSON.stringify({
    jankenPlayer: round.jankenPlayer,
    jankenCpu: round.jankenCpu,
    jankenOutcome: round.jankenOutcome,
    playerDirection: round.playerDirection,
    cpuDirection: round.cpuDirection,
  });

  const persisted = await recordAcchiPlay(session.user.id, round.result, detail);

  if (!persisted.accepted) {
    // 本日の上限に達している
    throw errors.rateLimited('本日のプレイ回数の上限に達しました。明日また挑戦してください');
  }

  if (persisted.reward > 0) {
    await logAudit({
      userId: session.user.id,
      action: 'points.game_reward',
      resource: `user:${session.user.id}`,
      metadata: { game: 'ACCHI_MUITE_HOI', amount: persisted.reward, result: persisted.result },
    });
  }

  return NextResponse.json({
    janken: {
      player: round.jankenPlayer,
      cpu: round.jankenCpu,
      outcome: round.jankenOutcome,
    },
    direction: {
      player: round.playerDirection,
      cpu: round.cpuDirection,
    },
    result: persisted.result,
    reward: persisted.reward,
    balance: persisted.balance,
    playedToday: persisted.playedToday,
    remaining: persisted.remaining,
  });
});
