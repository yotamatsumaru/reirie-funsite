/**
 * POST /api/tickets/link/start
 *  - ローチケ連携を開始
 *  - 入力: { lawsonUserId }
 *  - ローチケ側にトークン発行を依頼し、verifyToken を保存
 *  - レスポンスでは verifyToken は返さない (ユーザーは別経路 ≒ ローチケ側で受け取る)
 *  - 開発(モック)モードでのみ devToken を返す
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { StartTicketLinkSchema } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';
import { startLawsonLink } from '@/lib/lawson';
import { env } from '@/lib/env';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const body = StartTicketLinkSchema.parse(await req.json());

  // 既に他ユーザーがこのローチケIDで LINKED の場合は拒否
  const existingForLawsonId = await prisma.ticketLink.findUnique({
    where: { lawsonUserId: body.lawsonUserId },
  });
  if (
    existingForLawsonId &&
    existingForLawsonId.userId !== session.user.id &&
    existingForLawsonId.status !== 'REVOKED'
  ) {
    throw errors.conflict('このローチケIDは別アカウントで連携済みです');
  }

  // 既に自分自身が LINKED 済みの場合
  const myLink = await prisma.ticketLink.findUnique({
    where: { userId: session.user.id },
  });
  if (myLink?.status === 'LINKED') {
    throw errors.conflict('既にローチケ連携済みです。先に解除してください');
  }

  // ローチケ側に検証トークン発行を依頼 (実APIまたはモック)
  const { verifyToken, expiresAt } = await startLawsonLink(body.lawsonUserId);

  // upsert: PENDING で保存
  const link = await prisma.ticketLink.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      lawsonUserId: body.lawsonUserId,
      status: 'PENDING',
      verifyToken,
    },
    update: {
      lawsonUserId: body.lawsonUserId,
      status: 'PENDING',
      verifyToken,
      revokedAt: null,
      linkedAt: null,
    },
  });

  await logAudit({
    userId: session.user.id,
    action: 'ticket.link.started',
    resource: `ticketLink:${link.id}`,
    metadata: { lawsonUserIdSuffix: body.lawsonUserId.slice(-4) },
  });

  return NextResponse.json({
    ok: true,
    expiresAt: expiresAt.toISOString(),
    // 開発モードのみトークンを返す (本番ではローチケ側からユーザーに通知される想定)
    devToken: env.isProduction ? undefined : verifyToken,
  });
});
