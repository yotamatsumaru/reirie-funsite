/**
 * GET /api/admin/reward-redemptions — 景品交換・発送管理 一覧
 *   クエリ ?status=PENDING などでフィルタ可能
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { REWARD_REDEMPTION_STATUSES } from '@idol/shared';
import { requireCapability } from '@/auth';
import { handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  await requireCapability('MERCH');
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const where =
    status && (REWARD_REDEMPTION_STATUSES as readonly string[]).includes(status)
      ? { status: status as (typeof REWARD_REDEMPTION_STATUSES)[number] }
      : {};

  const redemptions = await prisma.rewardRedemption.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      user: { select: { id: true, email: true, displayName: true, memberNumber: true } },
    },
  });
  return NextResponse.json({ redemptions });
});
