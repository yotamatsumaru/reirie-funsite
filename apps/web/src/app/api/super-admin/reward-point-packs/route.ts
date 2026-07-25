/**
 * GET  /api/super-admin/reward-point-packs — 特典ポイントパック一覧
 * POST /api/super-admin/reward-point-packs — 新規作成
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { AdminRewardPointPackInputSchema } from '@idol/shared';
import { requireSuperAdmin, requireSuperAdminView } from '@/auth';
import { handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireSuperAdminView();
  const packs = await prisma.rewardPointPack.findMany({
    orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }],
    include: { _count: { select: { purchases: true } } },
  });
  return NextResponse.json({ packs });
});

export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();
  const body = AdminRewardPointPackInputSchema.parse(await req.json());
  const created = await prisma.rewardPointPack.create({ data: body });
  await logAudit({
    userId: session.user.id,
    action: 'reward_point_pack.create',
    resource: created.id,
  });
  return NextResponse.json({ pack: created }, { status: 201 });
});
