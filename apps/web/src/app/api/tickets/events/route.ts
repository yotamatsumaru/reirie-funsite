/**
 * GET /api/tickets/events
 *  - 公開中のチケットイベント一覧
 *  - ?upcoming=true で開催日が未来のもののみ
 *  - 認証ユーザーには 自分の連携状況 / 先行販売権の有無 も付与
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { handle } from '@/lib/errors';
import { canAccess } from '@idol/shared';
import type { Prisma } from '@idol/db';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const upcoming = url.searchParams.get('upcoming') === 'true';

  const where: Prisma.TicketEventWhereInput = {
    isActive: true,
    ...(upcoming ? { performedAt: { gte: new Date() } } : {}),
  };

  const events = await prisma.ticketEvent.findMany({
    where,
    orderBy: { performedAt: 'asc' },
    take: 100,
  });

  const session = await auth();
  let grantsMap = new Map<string, { grantedAt: Date; expiresAt: Date | null }>();
  let hasLink = false;

  if (session?.user?.id) {
    const link = await prisma.ticketLink.findUnique({
      where: { userId: session.user.id },
      include: {
        grants: {
          where: { eventId: { in: events.map((e) => e.id) } },
        },
      },
    });
    if (link && link.status === 'LINKED') {
      hasLink = true;
      grantsMap = new Map(
        link.grants.map((g) => [g.eventId, { grantedAt: g.grantedAt, expiresAt: g.expiresAt }]),
      );
    }
  }

  const items = events.map((e) => {
    const grant = grantsMap.get(e.id);
    const eligible = canAccess(session?.user?.plan, requiredAccess(e.requiredPlan));
    return {
      id: e.id,
      externalEventId: e.externalEventId,
      title: e.title,
      description: e.description,
      venue: e.venue,
      performedAt: e.performedAt.toISOString(),
      presaleStartAt: e.presaleStartAt?.toISOString() ?? null,
      presaleEndAt: e.presaleEndAt?.toISOString() ?? null,
      publicSaleAt: e.publicSaleAt?.toISOString() ?? null,
      requiredPlan: e.requiredPlan,
      // ユーザー固有
      userStatus: session?.user?.id
        ? {
            hasLink,
            eligible,
            granted: !!grant,
            grantedAt: grant?.grantedAt.toISOString() ?? null,
            grantExpiresAt: grant?.expiresAt?.toISOString() ?? null,
          }
        : null,
    };
  });

  return NextResponse.json({ items });
});

function requiredAccess(plan: 'FREE' | 'STANDARD' | 'PREMIUM'): 'PUBLIC' | 'MEMBERS' | 'PREMIUM' {
  if (plan === 'PREMIUM') return 'PREMIUM';
  if (plan === 'STANDARD') return 'MEMBERS';
  return 'PUBLIC';
}
