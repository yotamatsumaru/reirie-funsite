/**
 * GET /api/me/reward-points — 特典ポイント残高 & 取引履歴 (直近 50 件)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireSession } from '@/auth';
import { handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  const session = await requireSession();
  const [user, transactions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { rewardPoints: true },
    }),
    prisma.rewardPointTransaction.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        amount: true,
        balance: true,
        reason: true,
        note: true,
        createdAt: true,
      },
    }),
  ]);
  return NextResponse.json({
    balance: user?.rewardPoints ?? 0,
    transactions,
  });
});
