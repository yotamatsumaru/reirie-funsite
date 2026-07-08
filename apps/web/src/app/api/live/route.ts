import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { canAccess } from '@idol/shared';
import { resolveApiSession } from '@/lib/api-auth';
import { handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const session = await resolveApiSession(req);
  const allowed: Array<'PUBLIC' | 'MEMBERS' | 'PREMIUM'> = ['PUBLIC'];
  if (canAccess(session?.user?.plan, 'MEMBERS')) allowed.push('MEMBERS');
  if (canAccess(session?.user?.plan, 'PREMIUM')) allowed.push('PREMIUM');

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
