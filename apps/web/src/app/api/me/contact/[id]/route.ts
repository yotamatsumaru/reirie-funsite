/**
 * GET /api/me/contact/[id] — 自分のお問い合わせのやり取り (チャット)
 *
 * 開いた (取得した) 時点で、届いている運営からのメッセージを既読にする。
 * 他人のお問い合わせは 404 (存在するかどうかも返さない)。
 * チャット画面は表示中、この API を定期的に呼んで新着を取り込む。
 */
import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';
import {
  loadMemberThread,
  markThreadReadByMember,
  memberPostDecision,
  toChatMessages,
} from '@/lib/contact-thread';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireApiSession(req);
  const { id } = await ctx.params;
  const thread = await loadMemberThread(session.user.id, id);
  if (!thread) throw errors.notFound('お問い合わせが見つかりません');

  const marked = await markThreadReadByMember(session.user.id, id);
  // 既読にした分を返却データにも反映する (読み直さずに済ませる)
  if (marked > 0) {
    const now = new Date();
    for (const r of thread.replies) if (r.sender === 'ADMIN' && !r.readAt) r.readAt = now;
  }

  return NextResponse.json(
    {
      thread: {
        id: thread.id,
        ticketNumber: thread.ticketNumber,
        subject: thread.subject,
        status: thread.status,
        canPost: memberPostDecision(thread, session.user.id).ok,
      },
      messages: toChatMessages(thread, 'MEMBER'),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
