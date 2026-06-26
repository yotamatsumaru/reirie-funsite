/**
 * あっち向いてホイ ミニゲーム API (v1 / クライアント非依存)
 *
 * GET  /api/v1/games/acchi  — 本日の残りプレイ回数 & 残高
 * POST /api/v1/games/acchi  — 1 プレイ実行 (手と方向を送信、結果はサーバーが確定)
 *
 * 認証: Bearer トークン (Unity 等) または Cookie セッション (Web) のどちらでも可。
 *       → Web 版と Unity 版が「同じエンドポイント・同じロジック」を共有できる。
 *
 * セキュリティは Web 版 (/api/me/games/acchi) と同一:
 *  - CPU の手 / 方向 / 勝敗はサーバーで生成・確定 (クライアントの結果は信用しない)。
 *  - 回数上限・ポイント付与はトランザクション内で原子的に処理。
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
import { handle, errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { requireApiPrincipal } from '@/lib/api-auth';
import { getAcchiPlayCountToday, recordAcchiPlay } from '@/lib/points';
import { resolveAcchiRound } from '@/lib/games/acchi';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const principal = await requireApiPrincipal(req);

  const [playedToday, user] = await Promise.all([
    getAcchiPlayCountToday(principal.userId),
    env.demoMode
      ? Promise.resolve(null)
      : prisma.user.findUnique({
          where: { id: principal.userId },
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
  const principal = await requireApiPrincipal(req);

  const body = (await req.json().catch(() => null)) as
    | { hand?: unknown; direction?: unknown }
    | null;
  if (!body || !isJankenHand(body.hand) || !isAcchiDirection(body.direction)) {
    throw errors.badRequest('手と方向を正しく指定してください');
  }

  const round = resolveAcchiRound(body.hand, body.direction);
  const detail = JSON.stringify({
    jankenPlayer: round.jankenPlayer,
    jankenCpu: round.jankenCpu,
    jankenOutcome: round.jankenOutcome,
    playerDirection: round.playerDirection,
    cpuDirection: round.cpuDirection,
  });

  const persisted = await recordAcchiPlay(principal.userId, round.result, detail);

  if (!persisted.accepted) {
    throw errors.rateLimited('本日のプレイ回数の上限に達しました。明日また挑戦してください');
  }

  if (persisted.reward > 0) {
    await logAudit({
      userId: principal.userId,
      action: 'points.game_reward',
      resource: `user:${principal.userId}`,
      metadata: {
        game: 'ACCHI_MUITE_HOI',
        amount: persisted.reward,
        result: persisted.result,
        via: principal.source,
      },
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
