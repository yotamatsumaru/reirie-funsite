/**
 * POST /api/tickets/presale/request
 *  - 先行販売権をリクエスト
 *  - 入力: { eventId }
 *  - 条件:
 *    1) ローチケ連携が LINKED 状態
 *    2) ユーザーのプランがイベントの requiredPlan 以上
 *    3) presaleStartAt 〜 presaleEndAt の期間内 (両方null なら常時OK)
 *    4) まだ付与されていない (重複防止)
 *  - ローチケ側へ通知 → DB に TicketPresaleGrant を upsert
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { RequestPresaleAccessSchema, planRank } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';
import { grantLawsonPresale } from '@/lib/lawson';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const body = RequestPresaleAccessSchema.parse(await req.json());

  // 1) イベント取得
  const event = await prisma.ticketEvent.findUnique({ where: { id: body.eventId } });
  if (!event || !event.isActive) throw errors.notFound('イベントが見つかりません');

  // 2) プランチェック
  if (planRank(session.user.plan) < planRank(event.requiredPlan)) {
    throw errors.planRequired(event.requiredPlan === 'PREMIUM' ? 'プレミアム' : 'スタンダード');
  }

  // 3) 期間チェック
  const now = new Date();
  if (event.presaleStartAt && now < event.presaleStartAt) {
    throw errors.badRequest('先行販売受付期間外です (まだ開始していません)');
  }
  if (event.presaleEndAt && now > event.presaleEndAt) {
    throw errors.badRequest('先行販売受付期間外です (受付終了済み)');
  }

  // 4) ローチケ連携チェック
  const link = await prisma.ticketLink.findUnique({
    where: { userId: session.user.id },
  });
  if (!link || link.status !== 'LINKED') {
    throw errors.badRequest('先にローチケ連携を完了してください');
  }

  // 5) 既存付与の確認
  const existing = await prisma.ticketPresaleGrant.findUnique({
    where: {
      ticketLinkId_eventId: { ticketLinkId: link.id, eventId: event.id },
    },
  });
  if (existing) {
    return NextResponse.json({
      ok: true,
      alreadyGranted: true,
      grantId: existing.id,
      grantedAt: existing.grantedAt.toISOString(),
      expiresAt: existing.expiresAt?.toISOString() ?? null,
    });
  }

  // 6) ローチケ側に通知 (モック or 実 API)
  // 有効期限は presaleEndAt があればそれ、無ければ performedAt
  const expiresAt = event.presaleEndAt ?? event.performedAt;
  const remote = await grantLawsonPresale({
    lawsonUserId: link.lawsonUserId,
    externalEventId: event.externalEventId,
    expiresAt,
  });
  if (!remote.ok) {
    await logAudit({
      userId: session.user.id,
      action: 'ticket.presale.request_failed',
      resource: `event:${event.id}`,
      metadata: { reason: remote.reason ?? 'remote_failed' },
    });
    throw errors.internal('ローチケ側との通信に失敗しました。時間をおいて再試行してください');
  }

  // 7) DB 登録
  const grant = await prisma.ticketPresaleGrant.create({
    data: {
      ticketLinkId: link.id,
      eventId: event.id,
      expiresAt,
    },
  });

  await logAudit({
    userId: session.user.id,
    action: 'ticket.presale.granted',
    resource: `presaleGrant:${grant.id}`,
    metadata: {
      eventId: event.id,
      externalEventId: event.externalEventId,
      externalGrantId: remote.externalGrantId ?? null,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      grantId: grant.id,
      grantedAt: grant.grantedAt.toISOString(),
      expiresAt: grant.expiresAt?.toISOString() ?? null,
    },
    { status: 201 },
  );
});
