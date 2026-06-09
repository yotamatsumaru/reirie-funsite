/**
 * GET /api/admin/game/players  - プレイヤー進捗一覧 (運営調査用)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireAdmin } from '@/auth';
import { handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  await requireAdmin();
  const url = new URL(req.url);
  const characterId = url.searchParams.get('characterId') ?? undefined;
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '30')));

  const [items, total] = await Promise.all([
    prisma.playerProgress.findMany({
      where: characterId ? { characterId } : undefined,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: { select: { id: true, email: true, displayName: true } },
        character: { select: { id: true, name: true, slug: true } },
      },
    }),
    prisma.playerProgress.count({
      where: characterId ? { characterId } : undefined,
    }),
  ]);
  return NextResponse.json({ items, page, limit, total });
});
