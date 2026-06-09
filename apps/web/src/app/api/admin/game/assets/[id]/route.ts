/**
 * DELETE /api/admin/game/assets/[id]
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const DELETE = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireAdmin();
    const { id } = await ctx.params;
    const existing = await prisma.gameAsset.findUnique({ where: { id } });
    if (!existing) throw errors.notFound();
    await prisma.gameAsset.delete({ where: { id } });
    await logAudit({ userId: session.user.id, action: 'game.asset.delete', resource: id });
    return NextResponse.json({ ok: true });
  },
);
