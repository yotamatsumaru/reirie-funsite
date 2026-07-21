/**
 * GET /api/me/summary — サイドバー等で使う会員概要 (プラン・ランク・保有ポイント)
 *
 * ポイント獲得/消費 (ログインボーナス・ミニゲーム・景品交換 等) の直後に
 * サイドバー表示を最新化するため、専用の軽量エンドポイントとして切り出す。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireApiSession } from '@/lib/api-auth';
import { handle } from '@/lib/errors';
import { getMemberRank } from '@/lib/membership-rank';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const session = await requireApiSession(req);

  const [user, { rank }] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { points: true },
    }),
    getMemberRank(session.user.id),
  ]);

  return NextResponse.json({
    plan: session.user.plan,
    rank,
    points: user?.points ?? 0,
  });
});
