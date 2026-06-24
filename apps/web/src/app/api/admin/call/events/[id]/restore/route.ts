/**
 * POST /api/admin/call/events/[id]/restore
 *
 * NO_SHOW にしたチケットを WAITING に戻す (救済オペレーション)。
 *
 * 使い所:
 *   - スキップしてしまったが、本人が遅れて到着した
 *   - 接続トラブル復旧後にもう一度キューへ戻したい
 *
 * 動作:
 *   - 対象チケットの status を WAITING に戻す
 *   - endedAt / enteredMainAt をクリア
 *   - queuePos は維持 (もとの番号は残るが、運用上は最後尾扱いになる)
 *     → 次の "next" 呼び出しで自然と最後の方になる (より小さい queuePos の WAITING が先に呼ばれる)
 *     ※ 厳密に「最後尾に並び直す」操作はやや別概念のため今回はスコープ外
 *
 * 認可: ADMIN 以上。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireCapability } from '@/auth';
import { handle, errors } from '@/lib/errors';
import { RestoreCallTicketSchema } from '@idol/shared';

export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

export const POST = handle(async (req, ctx: Ctx) => {
  await requireCapability('CALL');
  const { id: eventId } = await ctx.params;

  const body = await req.json();
  const { ticketId } = RestoreCallTicketSchema.parse(body);

  const ticket = await prisma.callTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw errors.notFound('チケットが見つかりません');
  if (ticket.eventId !== eventId) {
    throw errors.badRequest('チケットがこのイベントに属していません');
  }
  if (ticket.status !== 'NO_SHOW' && ticket.status !== 'DONE') {
    throw errors.conflict('このチケットは NO_SHOW / DONE 状態ではありません');
  }

  const updated = await prisma.callTicket.update({
    where: { id: ticketId },
    data: {
      status: 'WAITING',
      endedAt: null,
      enteredMainAt: null,
    },
  });
  return NextResponse.json({ ticket: updated });
});
