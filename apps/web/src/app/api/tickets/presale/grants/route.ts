/**
 * GET /api/tickets/presale/grants
 *  - 自分が獲得した先行販売権の一覧
 *  - ?includeExpired=true で過去のものも含める
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireSession } from '@/auth';
import { handle } from '@/lib/errors';
import type { Prisma } from '@idol/db';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const session = await requireSession();
  const url = new URL(req.url);
  const includeExpired = url.searchParams.get('includeExpired') === 'true';

  const link = await prisma.ticketLink.findUnique({
    where: { userId: session.user.id },
  });
  if (!link) {
    return NextResponse.json({ items: [], hasLink: false });
  }

  const now = new Date();
  const where: Prisma.TicketPresaleGrantWhereInput = {
    ticketLinkId: link.id,
    ...(includeExpired
      ? {}
      : {
          OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
        }),
  };

  const grants = await prisma.ticketPresaleGrant.findMany({
    where,
    orderBy: { grantedAt: 'desc' },
    include: {
      event: {
        select: {
          id: true,
          externalEventId: true,
          title: true,
          venue: true,
          performedAt: true,
          presaleStartAt: true,
          presaleEndAt: true,
          publicSaleAt: true,
        },
      },
    },
    take: 200,
  });

  const items = grants.map((g) => ({
    grantId: g.id,
    grantedAt: g.grantedAt.toISOString(),
    expiresAt: g.expiresAt?.toISOString() ?? null,
    redeemedAt: g.redeemedAt?.toISOString() ?? null,
    event: {
      id: g.event.id,
      externalEventId: g.event.externalEventId,
      title: g.event.title,
      venue: g.event.venue,
      performedAt: g.event.performedAt.toISOString(),
      presaleStartAt: g.event.presaleStartAt?.toISOString() ?? null,
      presaleEndAt: g.event.presaleEndAt?.toISOString() ?? null,
      publicSaleAt: g.event.publicSaleAt?.toISOString() ?? null,
    },
  }));

  return NextResponse.json({
    items,
    hasLink: link.status === 'LINKED',
  });
});
