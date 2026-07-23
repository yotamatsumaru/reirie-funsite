/**
 * GET /api/me/points — Pui 残高 & 取引履歴 (直近 50 件)
 * 【2026-07 通貨名変更】URL 自体 (points) は後方互換のため変更していない。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireApiSession } from '@/lib/api-auth';
import { handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const [user, transactions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { pui: true },
    }),
    prisma.puiTransaction.findMany({
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
    balance: user?.pui ?? 0,
    transactions,
  });
});
