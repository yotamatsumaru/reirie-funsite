/**
 * PATCH  /api/admin/game/items/[id]
 * DELETE /api/admin/game/items/[id]
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { AdminGameItemInputSchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('GAME');
    const { id } = await ctx.params;
    const body = AdminGameItemInputSchema.partial().parse(await req.json());
    const existing = await prisma.gameItem.findUnique({ where: { id } });
    if (!existing) throw errors.notFound();
    const updated = await prisma.gameItem.update({ where: { id }, data: body });
    await logAudit({ userId: session.user.id, action: 'game.item.update', resource: id });
    return NextResponse.json({ item: updated });
  },
);

export const DELETE = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('GAME');
    const { id } = await ctx.params;
    const existing = await prisma.gameItem.findUnique({
      where: { id },
      include: { _count: { select: { inventories: true, purchases: true } } },
    });
    if (!existing) throw errors.notFound();
    if (existing._count.inventories > 0 || existing._count.purchases > 0) {
      const updated = await prisma.gameItem.update({
        where: { id },
        data: { isActive: false },
      });
      await logAudit({ userId: session.user.id, action: 'game.item.deactivate', resource: id });
      return NextResponse.json({ item: updated, deactivated: true });
    }
    await prisma.gameItem.delete({ where: { id } });
    await logAudit({ userId: session.user.id, action: 'game.item.delete', resource: id });
    return NextResponse.json({ ok: true });
  },
);
