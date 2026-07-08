/**
 * GET /api/tickets/events/[id]
 *  - チケットイベント詳細
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { resolveApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const event = await prisma.ticketEvent.findUnique({ where: { id } });
    if (!event || !event.isActive) throw errors.notFound('イベントが見つかりません');

    const session = await resolveApiSession(req);
    let userStatus: {
      hasLink: boolean;
      granted: boolean;
      grantedAt: string | null;
      grantExpiresAt: string | null;
    } | null = null;

    if (session?.user?.id) {
      const link = await prisma.ticketLink.findUnique({
        where: { userId: session.user.id },
        include: { grants: { where: { eventId: id } } },
      });
      const linked = link?.status === 'LINKED';
      const grant = link?.grants[0];
      userStatus = {
        hasLink: !!linked,
        granted: !!grant,
        grantedAt: grant?.grantedAt.toISOString() ?? null,
        grantExpiresAt: grant?.expiresAt?.toISOString() ?? null,
      };
    }

    return NextResponse.json({
      id: event.id,
      externalEventId: event.externalEventId,
      title: event.title,
      description: event.description,
      venue: event.venue,
      performedAt: event.performedAt.toISOString(),
      presaleStartAt: event.presaleStartAt?.toISOString() ?? null,
      presaleEndAt: event.presaleEndAt?.toISOString() ?? null,
      publicSaleAt: event.publicSaleAt?.toISOString() ?? null,
      requiredPlan: event.requiredPlan,
      userStatus,
    });
  },
);
