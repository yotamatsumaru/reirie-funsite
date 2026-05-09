import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireSession } from '@/auth';
import { handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  const session = await requireSession();
  const payments = await prisma.payment.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return NextResponse.json({ items: payments });
});
