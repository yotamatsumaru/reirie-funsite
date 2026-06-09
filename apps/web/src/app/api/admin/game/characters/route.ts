/**
 * GET  /api/admin/game/characters - 全キャラ (DRAFT 含む)
 * POST /api/admin/game/characters - 新規作成
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { AdminGameCharacterInputSchema } from '@idol/shared';
import { requireAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireAdmin();
  const items = await prisma.gameCharacter.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    include: { _count: { select: { scenarios: true, progresses: true } } },
  });
  return NextResponse.json({ items });
});

export const POST = handle(async (req: Request) => {
  const session = await requireAdmin();
  const body = AdminGameCharacterInputSchema.parse(await req.json());

  const exists = await prisma.gameCharacter.findUnique({ where: { slug: body.slug } });
  if (exists) throw errors.conflict('同じ slug のキャラクターが既に存在します');

  const created = await prisma.gameCharacter.create({
    data: {
      ...body,
      publishedAt: body.status === 'PUBLISHED' ? new Date() : null,
    },
  });
  await logAudit({
    userId: session.user.id,
    action: 'game.character.create',
    resource: created.id,
  });
  return NextResponse.json({ character: created }, { status: 201 });
});
