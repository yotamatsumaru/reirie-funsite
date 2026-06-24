/**
 * GET  /api/admin/game/items
 * POST /api/admin/game/items
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { AdminGameItemInputSchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireCapability('GAME');
  const items = await prisma.gameItem.findMany({
    orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }],
    include: { character: { select: { id: true, name: true, slug: true } } },
  });
  return NextResponse.json({ items });
});

export const POST = handle(async (req: Request) => {
  const session = await requireCapability('GAME');
  const body = AdminGameItemInputSchema.parse(await req.json());
  const dup = await prisma.gameItem.findUnique({ where: { slug: body.slug } });
  if (dup) throw errors.conflict('同じ slug のアイテムが既に存在します');
  const created = await prisma.gameItem.create({ data: body });
  await logAudit({ userId: session.user.id, action: 'game.item.create', resource: created.id });
  return NextResponse.json({ item: created }, { status: 201 });
});
