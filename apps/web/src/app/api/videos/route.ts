import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { canAccess } from '@idol/shared';
import { auth } from '@/auth';
import { handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  const session = await auth();
  const allowed: Array<'PUBLIC' | 'MEMBERS' | 'PREMIUM'> = ['PUBLIC'];
  if (canAccess(session?.user?.plan, 'MEMBERS')) allowed.push('MEMBERS');
  if (canAccess(session?.user?.plan, 'PREMIUM')) allowed.push('PREMIUM');

  const items = await prisma.video.findMany({
    where: {
      status: 'READY',
      publishedAt: { lte: new Date() },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      accessLevel: { in: allowed },
    },
    orderBy: { publishedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      description: true,
      thumbnailUrl: true,
      durationSeconds: true,
      accessLevel: true,
      publishedAt: true,
    },
  });
  return NextResponse.json({ items });
});
