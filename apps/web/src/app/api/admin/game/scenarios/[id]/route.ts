/**
 * GET    /api/admin/game/scenarios/[id]
 * PATCH  /api/admin/game/scenarios/[id]
 * DELETE /api/admin/game/scenarios/[id]
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { AdminGameScenarioInputSchema, validateScenarioScript } from '@idol/shared';
import { requireAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const sc = await prisma.gameScenario.findUnique({
    where: { id },
    include: { character: { select: { id: true, name: true, slug: true } } },
  });
  if (!sc) throw errors.notFound();
  return NextResponse.json({ scenario: sc });
});

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireAdmin();
    const { id } = await ctx.params;
    const body = AdminGameScenarioInputSchema.partial().parse(await req.json());

    const existing = await prisma.gameScenario.findUnique({ where: { id } });
    if (!existing) throw errors.notFound();

    let scriptJson: unknown = existing.scriptJson;
    if (body.scriptJson !== undefined) {
      const v = validateScenarioScript(body.scriptJson);
      if (!v.ok) throw errors.unprocessable('シナリオ JSON が不正です', v.errors);
      scriptJson = v.script;
    }

    const willPublish =
      body.status === 'PUBLISHED' && existing.status !== 'PUBLISHED';

    const updated = await prisma.gameScenario.update({
      where: { id },
      data: {
        ...body,
        scriptJson: scriptJson as never,
        publishedAt: willPublish ? new Date() : existing.publishedAt,
      },
    });
    await logAudit({
      userId: session.user.id,
      action: 'game.scenario.update',
      resource: id,
    });
    return NextResponse.json({ scenario: updated });
  },
);

export const DELETE = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireAdmin();
    const { id } = await ctx.params;
    const existing = await prisma.gameScenario.findUnique({
      where: { id },
      include: { _count: { select: { inventories: true, purchases: true } } },
    });
    if (!existing) throw errors.notFound();
    if (existing._count.inventories > 0 || existing._count.purchases > 0) {
      const updated = await prisma.gameScenario.update({
        where: { id },
        data: { status: 'ARCHIVED' },
      });
      await logAudit({
        userId: session.user.id,
        action: 'game.scenario.archive',
        resource: id,
      });
      return NextResponse.json({ scenario: updated, archived: true });
    }
    await prisma.gameScenario.delete({ where: { id } });
    await logAudit({
      userId: session.user.id,
      action: 'game.scenario.delete',
      resource: id,
    });
    return NextResponse.json({ ok: true });
  },
);
