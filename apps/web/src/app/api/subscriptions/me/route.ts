import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireApiSession } from '@/lib/api-auth';
import { handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const sub = await prisma.subscription.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ subscription: sub });
});
