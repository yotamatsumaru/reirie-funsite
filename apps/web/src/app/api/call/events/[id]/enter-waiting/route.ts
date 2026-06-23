/**
 * POST /api/call/events/[id]/enter-waiting
 *
 * ファンが待機室ページにアクセスした際に呼ばれる "自動入室" エンドポイント。
 *
 * 動作:
 *   - 認証済みの本人のチケットを WAITING → IN_WAITING_ROOM に進める
 *   - 既に IN_WAITING_ROOM / IN_MAIN_ROOM / DONE / NO_SHOW のチケットは何もしない (idempotent)
 *   - 他人のチケットや存在しないチケットの場合は 403/404
 *
 * 使い所:
 *   - WaitingRoom.tsx の初回マウントでバックグラウンド送信
 *   - 「いま誰が実際に待機しているか」をスタッフが把握できるようにする
 *
 * 認可:
 *   - ログイン必須
 *   - ticketId が自分のものであること
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@idol/db';
import { handle, errors } from '@/lib/errors';
import { EnterCallWaitingRoomSchema } from '@idol/shared';

export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

export const POST = handle(async (req, ctx: Ctx) => {
  const session = await auth();
  if (!session?.user?.id) throw errors.unauthorized();
  const userId = session.user.id;

  const { id: eventId } = await ctx.params;

  const body = await req.json().catch(() => ({}));
  const { ticketId } = EnterCallWaitingRoomSchema.parse(body);

  const ticket = await prisma.callTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw errors.notFound('チケットが見つかりません');
  if (ticket.eventId !== eventId) {
    throw errors.badRequest('チケットがこのイベントに属していません');
  }
  if (ticket.userId !== userId) {
    throw errors.forbidden('他人のチケットは操作できません');
  }

  // WAITING のときだけ IN_WAITING_ROOM に進める。
  // 他の状態は idempotent に no-op。
  if (ticket.status !== 'WAITING') {
    return NextResponse.json({ ticket, changed: false });
  }

  const updated = await prisma.callTicket.update({
    where: { id: ticketId },
    data: {
      status: 'IN_WAITING_ROOM',
      enteredWaitingAt: new Date(),
    },
  });
  return NextResponse.json({ ticket: updated, changed: true });
});
