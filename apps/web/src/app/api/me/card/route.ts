/**
 * GET /api/me/card — 会員カード情報を取得 (会員番号を未付与なら採番する)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireApiSession } from '@/lib/api-auth';
import { handle } from '@/lib/errors';
import { ensureMemberNumber } from '@/lib/points';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const memberNumber = await ensureMemberNumber(session.user.id);
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      displayName: true,
      email: true,
      points: true,
      createdAt: true,
    },
  });
  return NextResponse.json({
    memberNumber,
    displayName: user?.displayName ?? null,
    email: user?.email ?? null,
    points: user?.points ?? 0,
    plan: session.user.plan,
    joinedAt: user?.createdAt ?? null,
  });
});
