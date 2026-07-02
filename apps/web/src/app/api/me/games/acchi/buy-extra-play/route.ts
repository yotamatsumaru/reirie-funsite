/**
 * POST /api/me/games/acchi/buy-extra-play
 *   - あっち向いてホイの本日の追加プレイ回数を Fan ポイントで購入する
 *   - 1 日に購入できる追加回数には上限がある (MAX_EXTRA_PLAYS_PER_DAY)
 *   - Fan ポイント残高不足時は 422 (POINT_INTEGRITY) を返す
 */
import { NextResponse } from 'next/server';
import { EXTRA_PLAY_COST_FAN_POINTS, MAX_EXTRA_PLAYS_PER_DAY } from '@idol/shared';
import { requireSession } from '@/auth';
import { handle, errors } from '@/lib/errors';
import { buyAcchiExtraPlay } from '@/lib/points';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const POST = handle(async () => {
  const session = await requireSession();
  const result = await buyAcchiExtraPlay(session.user.id);

  if (!result.ok) {
    throw errors.rateLimited(
      `本日の追加プレイ購入は上限 (${MAX_EXTRA_PLAYS_PER_DAY}回) に達しています`,
    );
  }

  await logAudit({
    userId: session.user.id,
    action: 'points.extra_play_purchase',
    resource: `user:${session.user.id}`,
    metadata: {
      game: 'ACCHI_MUITE_HOI',
      cost: EXTRA_PLAY_COST_FAN_POINTS,
      purchasedToday: result.purchasedToday,
    },
  });

  return NextResponse.json({
    balance: result.balance,
    purchasedToday: result.purchasedToday,
    maxPerDay: result.maxPerDay,
    cost: EXTRA_PLAY_COST_FAN_POINTS,
  });
});
