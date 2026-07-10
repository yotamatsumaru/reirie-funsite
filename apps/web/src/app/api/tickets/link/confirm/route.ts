/**
 * POST /api/tickets/link/confirm
 *  - ユーザーがローチケで受け取った verifyToken を入力して連携完了
 *  - DBの verifyToken と一致 + ローチケ側でも確認OKなら LINKED に遷移
 */
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { prisma } from '@idol/db';
import { ConfirmTicketLinkSchema } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';
import { confirmLawsonLink } from '@/lib/lawson';
import { logAudit } from '@/lib/audit';

/** 定数時間で文字列を比較する (タイミング攻撃対策) */
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // 長さが違う場合も一定時間かけてダミー比較し、早期リターンによる時間差を減らす
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

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

  // DB のトークンと一致しなければ拒否 (タイミング攻撃対策で定数時間比較)
  if (!timingSafeStringEqual(link.verifyToken.toUpperCase(), body.verifyToken.toUpperCase())) {
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
