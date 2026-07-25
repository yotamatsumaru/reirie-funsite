/**
 * GET /api/me/summary — サイドバー等で使う会員概要 (プラン・ランク・保有 Pui)
 *
 * Pui 獲得/消費 (ログインボーナス・ミニゲーム・景品交換 等) の直後に
 * サイドバー表示を最新化するため、専用の軽量エンドポイントとして切り出す。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireApiSession } from '@/lib/api-auth';
import { handle } from '@/lib/errors';
import { getMemberRank } from '@/lib/membership-rank';
import { getLivePlan } from '@/lib/plan';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const session = await requireApiSession(req);

  // プランは JWT (session.user.plan) が最大5分キャッシュされ古い値になり得るため、
  // DB の有効なサブスクリプションから直接取得してサイドバー表示へ即時反映させる。
  const [user, { rank }, plan] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { pui: true },
    }),
    getMemberRank(session.user.id),
    getLivePlan(session.user.id),
  ]);

  return NextResponse.json({
    plan,
    rank,
    points: user?.pui ?? 0,
  });
});
