import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireApiSession } from '@/lib/api-auth';
import { handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const orders = await prisma.order.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      items: {
        select: { productName: true, variantName: true, quantity: true, unitPrice: true },
      },
    },
  });
  return NextResponse.json({ items: orders });
});
