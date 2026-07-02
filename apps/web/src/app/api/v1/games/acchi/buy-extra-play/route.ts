/**
 * POST /api/v1/games/acchi/buy-extra-play
 *   - あっち向いてホイの本日の追加プレイ回数を Fan ポイントで購入する (トークン認証 / Unity 等)
 *   - Web 版 (/api/me/games/acchi/buy-extra-play) と同一ロジックを共有する
 *   - 1 日に購入できる追加回数には上限がある (MAX_EXTRA_PLAYS_PER_DAY)
 *   - Fan ポイント残高不足時は 422 (POINT_INTEGRITY) を返す
 */
import { NextResponse } from 'next/server';
import { EXTRA_PLAY_COST_FAN_POINTS, MAX_EXTRA_PLAYS_PER_DAY } from '@idol/shared';
import { requireApiPrincipal } from '@/lib/api-auth';
import { handle, errors } from '@/lib/errors';
import { buyAcchiExtraPlay } from '@/lib/points';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const principal = await requireApiPrincipal(req);
  const result = await buyAcchiExtraPlay(principal.userId);

  if (!result.ok) {
    throw errors.rateLimited(
      `本日の追加プレイ購入は上限 (${MAX_EXTRA_PLAYS_PER_DAY}回) に達しています`,
    );
  }

  await logAudit({
    userId: principal.userId,
    action: 'points.extra_play_purchase',
    resource: `user:${principal.userId}`,
    metadata: {
      game: 'ACCHI_MUITE_HOI',
      cost: EXTRA_PLAY_COST_FAN_POINTS,
      purchasedToday: result.purchasedToday,
      via: principal.source,
    },
  });

  return NextResponse.json({
    balance: result.balance,
    purchasedToday: result.purchasedToday,
    maxPerDay: result.maxPerDay,
    cost: EXTRA_PLAY_COST_FAN_POINTS,
  });
});
