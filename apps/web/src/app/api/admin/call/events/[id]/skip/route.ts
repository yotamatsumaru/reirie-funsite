/**
 * POST /api/admin/call/events/[id]/skip
 *
 * 特定チケットをスキップ (NO_SHOW) する。
 *
 * 使い所:
 *   - シリアル引換しただけで当日来ない人
 *   - 通話接続不能で復旧不能と判断した人
 *
 * 動作:
 *   - 該当チケットの status を NO_SHOW に変更
 *   - endedAt を記録
 *   - キュー順自体 (queuePos) は変えない (履歴を残す)
 *
 * 認可: ADMIN 以上。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireCapability } from '@/auth';
import { handle, errors } from '@/lib/errors';
import { SkipCallTicketSchema } from '@idol/shared';

export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

export const POST = handle(async (req, ctx: Ctx) => {
  await requireCapability('CALL');
  const { id: eventId } = await ctx.params;

  const body = await req.json();
  const { ticketId } = SkipCallTicketSchema.parse(body);

  const ticket = await prisma.callTicket.findUnique({
    where: { id: ticketId },
  });
  if (!ticket) throw errors.notFound('チケットが見つかりません');
  if (ticket.eventId !== eventId) {
    throw errors.badRequest('チケットがこのイベントに属していません');
  }
  if (ticket.status === 'DONE' || ticket.status === 'NO_SHOW') {
    throw errors.conflict('このチケットは既に終了しています');
  }

  const updated = await prisma.callTicket.update({
    where: { id: ticketId },
    data: { status: 'NO_SHOW', endedAt: new Date() },
  });
  return NextResponse.json({ ticket: updated });
});
