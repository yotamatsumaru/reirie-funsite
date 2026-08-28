import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { accessibleLevels } from '@idol/shared';
import { resolveApiSession } from '@/lib/api-auth';
import { handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const session = await resolveApiSession(req);
  // 公開範囲の段階を追加したときにここの列挙を直し忘れると、
  // その段階のコンテンツが誰にも表示されなくなるので共通関数から導出する。
  const allowed = accessibleLevels(session?.user?.plan);

  const items = await prisma.liveStream.findMany({
    where: {
      status: { in: ['SCHEDULED', 'LIVE'] },
      accessLevel: { in: allowed },
    },
    orderBy: [{ status: 'asc' }, { scheduledStartAt: 'asc' }],
    take: 20,
    select: {
      id: true,
      title: true,
      description: true,
      thumbnailUrl: true,
      accessLevel: true,
      status: true,
      scheduledStartAt: true,
      startedAt: true,
    },
  });
  return NextResponse.json({ items });
});
