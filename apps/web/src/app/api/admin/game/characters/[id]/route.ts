/**
 * GET    /api/admin/game/characters/[id]
 * PATCH  /api/admin/game/characters/[id]
 * DELETE /api/admin/game/characters/[id]
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { AdminGameCharacterInputSchema } from '@idol/shared';
import { requireAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const character = await prisma.gameCharacter.findUnique({
    where: { id },
    include: {
      scenarios: { orderBy: { chapterNumber: 'asc' } },
      assets: { orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }] },
    },
  });
  if (!character) throw errors.notFound();
  return NextResponse.json({ character });
});

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireAdmin();
    const { id } = await ctx.params;
    const body = AdminGameCharacterInputSchema.partial().parse(await req.json());

    const existing = await prisma.gameCharacter.findUnique({ where: { id } });
    if (!existing) throw errors.notFound();

    if (body.slug && body.slug !== existing.slug) {
      const dup = await prisma.gameCharacter.findUnique({ where: { slug: body.slug } });
      if (dup) throw errors.conflict('同じ slug のキャラクターが既に存在します');
    }

    const willPublish =
      body.status === 'PUBLISHED' && existing.status !== 'PUBLISHED';

    const updated = await prisma.gameCharacter.update({
      where: { id },
      data: {
        ...body,
        publishedAt: willPublish ? new Date() : existing.publishedAt,
      },
    });
    await logAudit({
      userId: session.user.id,
      action: 'game.character.update',
      resource: id,
    });
    return NextResponse.json({ character: updated });
  },
);

export const DELETE = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireAdmin();
    const { id } = await ctx.params;
    const existing = await prisma.gameCharacter.findUnique({
      where: { id },
      include: { _count: { select: { scenarios: true, progresses: true } } },
    });
    if (!existing) throw errors.notFound();
    if (existing._count.progresses > 0) {
      // 進捗があるキャラはアーカイブのみ
      const updated = await prisma.gameCharacter.update({
        where: { id },
        data: { status: 'ARCHIVED' },
      });
      await logAudit({
        userId: session.user.id,
        action: 'game.character.archive',
        resource: id,
      });
      return NextResponse.json({ character: updated, archived: true });
    }
    await prisma.gameCharacter.delete({ where: { id } });
    await logAudit({
      userId: session.user.id,
      action: 'game.character.delete',
      resource: id,
    });
    return NextResponse.json({ ok: true });
  },
);
