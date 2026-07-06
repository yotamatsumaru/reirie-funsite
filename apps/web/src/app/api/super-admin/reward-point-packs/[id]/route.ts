/**
 * PATCH  /api/super-admin/reward-point-packs/[id] — 更新
 * DELETE /api/super-admin/reward-point-packs/[id] — 削除 (購入履歴があれば非活性化)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { AdminRewardPointPackInputSchema } from '@idol/shared';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireSuperAdmin();
    const { id } = await ctx.params;
    const body = AdminRewardPointPackInputSchema.partial().parse(await req.json());
    const existing = await prisma.rewardPointPack.findUnique({ where: { id } });
    if (!existing) throw errors.notFound();
    const updated = await prisma.rewardPointPack.update({ where: { id }, data: body });
    await logAudit({
      userId: session.user.id,
      action: 'reward_point_pack.update',
      resource: id,
    });
    return NextResponse.json({ pack: updated });
  },
);

export const DELETE = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireSuperAdmin();
    const { id } = await ctx.params;
    const existing = await prisma.rewardPointPack.findUnique({
      where: { id },
      include: { _count: { select: { purchases: true } } },
    });
    if (!existing) throw errors.notFound();
    if (existing._count.purchases > 0) {
      const updated = await prisma.rewardPointPack.update({
        where: { id },
        data: { isActive: false },
      });
      await logAudit({
        userId: session.user.id,
        action: 'reward_point_pack.deactivate',
        resource: id,
      });
      return NextResponse.json({ pack: updated, deactivated: true });
    }
    await prisma.rewardPointPack.delete({ where: { id } });
    await logAudit({
      userId: session.user.id,
      action: 'reward_point_pack.delete',
      resource: id,
    });
    return NextResponse.json({ ok: true });
  },
);
