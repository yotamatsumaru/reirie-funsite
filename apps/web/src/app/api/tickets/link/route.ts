/**
 * GET /api/tickets/link
 *  - 自分のローチケ連携状況を取得
 * DELETE /api/tickets/link
 *  - 連携解除 (REVOKED 化、grants は残す)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireSession } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  const session = await requireSession();
  const link = await prisma.ticketLink.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      lawsonUserId: true,
      status: true,
      linkedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });
  if (!link) {
    return NextResponse.json({ link: null });
  }
  // lawsonUserId はマスクして返す (末尾4桁のみ)
  const masked = link.lawsonUserId.length > 4
    ? '****' + link.lawsonUserId.slice(-4)
    : '****';
  return NextResponse.json({
    link: {
      id: link.id,
      lawsonUserIdMasked: masked,
      status: link.status,
      linkedAt: link.linkedAt?.toISOString() ?? null,
      revokedAt: link.revokedAt?.toISOString() ?? null,
      createdAt: link.createdAt.toISOString(),
    },
  });
});

export const DELETE = handle(async () => {
  const session = await requireSession();
  const link = await prisma.ticketLink.findUnique({
    where: { userId: session.user.id },
  });
  if (!link) throw errors.notFound('連携が見つかりません');
  if (link.status === 'REVOKED') {
    return NextResponse.json({ ok: true, alreadyRevoked: true });
  }
  await prisma.ticketLink.update({
    where: { id: link.id },
    data: { status: 'REVOKED', revokedAt: new Date(), verifyToken: null },
  });
  await logAudit({
    userId: session.user.id,
    action: 'ticket.link.revoked',
    resource: `ticketLink:${link.id}`,
  });
  return NextResponse.json({ ok: true });
});
