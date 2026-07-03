/**
 * GET  /api/admin/reward-catalog  — 景品カタログ一覧
 * POST /api/admin/reward-catalog  — 景品カタログ新規作成
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { AdminRewardCatalogItemInputSchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireCapability('MERCH');
  const items = await prisma.rewardCatalogItem.findMany({
    orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }],
    include: { _count: { select: { redemptions: true } } },
  });
  return NextResponse.json({ items });
});

export const POST = handle(async (req: Request) => {
  const session = await requireCapability('MERCH');
  const body = AdminRewardCatalogItemInputSchema.parse(await req.json());
  const dup = await prisma.rewardCatalogItem.findUnique({ where: { slug: body.slug } });
  if (dup) throw errors.conflict('同じ slug の景品が既に存在します');
  const created = await prisma.rewardCatalogItem.create({ data: body });
  await logAudit({
    userId: session.user.id,
    action: 'reward_catalog.create',
    resource: created.id,
  });
  return NextResponse.json({ item: created }, { status: 201 });
});
