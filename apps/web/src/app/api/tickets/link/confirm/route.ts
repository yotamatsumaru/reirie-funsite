/**
 * POST /api/tickets/link/confirm
 *  - ユーザーがローチケで受け取った verifyToken を入力して連携完了
 *  - DBの verifyToken と一致 + ローチケ側でも確認OKなら LINKED に遷移
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { ConfirmTicketLinkSchema } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';
import { confirmLawsonLink } from '@/lib/lawson';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const body = ConfirmTicketLinkSchema.parse(await req.json());

  const link = await prisma.ticketLink.findUnique({
    where: { userId: session.user.id },
  });
  if (!link) throw errors.notFound('連携手続きが見つかりません');
  if (link.status === 'LINKED') {
    return NextResponse.json({ ok: true, alreadyLinked: true });
  }
  if (link.status === 'REVOKED') {
    throw errors.conflict('連携が無効化されています。最初からやり直してください');
  }
  if (!link.verifyToken) throw errors.badRequest('検証トークンが設定されていません');

  // DB のトークンと一致しなければ拒否
  if (link.verifyToken.toUpperCase() !== body.verifyToken.toUpperCase()) {
    await logAudit({
      userId: session.user.id,
      action: 'ticket.link.confirm_failed',
      resource: `ticketLink:${link.id}`,
      metadata: { reason: 'token_mismatch' },
    });
    throw errors.badRequest('検証コードが一致しません');
  }

  // ローチケ側にも確認 (モックでも ok 判定)
  const remote = await confirmLawsonLink(link.lawsonUserId, body.verifyToken);
  if (!remote.ok) {
    await logAudit({
      userId: session.user.id,
      action: 'ticket.link.confirm_failed',
      resource: `ticketLink:${link.id}`,
      metadata: { reason: remote.reason ?? 'remote_rejected' },
    });
    throw errors.badRequest('ローチケ側で検証に失敗しました');
  }

  const updated = await prisma.ticketLink.update({
    where: { id: link.id },
    data: {
      status: 'LINKED',
      linkedAt: new Date(),
      verifyToken: null,
    },
  });

  await logAudit({
    userId: session.user.id,
    action: 'ticket.link.linked',
    resource: `ticketLink:${updated.id}`,
  });

  return NextResponse.json({
    ok: true,
    linkedAt: updated.linkedAt?.toISOString() ?? null,
  });
});
