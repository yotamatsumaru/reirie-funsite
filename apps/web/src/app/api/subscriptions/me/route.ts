import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireSession } from '@/auth';
import { handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  const session = await requireSession();
  const sub = await prisma.subscription.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ subscription: sub });
});
