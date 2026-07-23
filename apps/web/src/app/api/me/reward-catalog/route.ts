/**
 * GET /api/me/reward-catalog — 公開中の景品カタログ一覧 (会員向け)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireApiSession } from '@/lib/api-auth';
import { handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  await requireApiSession(req);
  const items = await prisma.rewardCatalogItem.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: [{ sortOrder: 'asc' }, { puiCost: 'asc' }],
    select: {
      id: true,
      slug: true,
      kind: true,
      name: true,
      description: true,
      imageUrl: true,
      puiCost: true,
      stock: true,
    },
  });
  return NextResponse.json({ items });
});
