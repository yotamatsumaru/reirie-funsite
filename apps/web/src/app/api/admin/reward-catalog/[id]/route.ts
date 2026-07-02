/**
 * PATCH  /api/admin/reward-catalog/[id]  — 景品カタログ更新
 * DELETE /api/admin/reward-catalog/[id]  — 景品カタログ削除 (交換履歴があればアーカイブ)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { AdminRewardCatalogItemInputSchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('MERCH');
    const { id } = await ctx.params;
    const body = AdminRewardCatalogItemInputSchema.partial().parse(await req.json());
    const existing = await prisma.rewardCatalogItem.findUnique({ where: { id } });
    if (!existing) throw errors.notFound();
    if (body.slug && body.slug !== existing.slug) {
      const dup = await prisma.rewardCatalogItem.findUnique({ where: { slug: body.slug } });
      if (dup) throw errors.conflict('同じ slug の景品が既に存在します');
    }
    const updated = await prisma.rewardCatalogItem.update({ where: { id }, data: body });
    await logAudit({ userId: session.user.id, action: 'reward_catalog.update', resource: id });
    return NextResponse.json({ item: updated });
  },
);

export const DELETE = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('MERCH');
    const { id } = await ctx.params;
    const existing = await prisma.rewardCatalogItem.findUnique({
      where: { id },
      include: { _count: { select: { redemptions: true } } },
    });
    if (!existing) throw errors.notFound();
    if (existing._count.redemptions > 0) {
      const updated = await prisma.rewardCatalogItem.update({
        where: { id },
        data: { status: 'ARCHIVED' },
      });
      await logAudit({
        userId: session.user.id,
        action: 'reward_catalog.archive',
        resource: id,
      });
      return NextResponse.json({ item: updated, archived: true });
    }
    await prisma.rewardCatalogItem.delete({ where: { id } });
    await logAudit({ userId: session.user.id, action: 'reward_catalog.delete', resource: id });
    return NextResponse.json({ ok: true });
  },
);
