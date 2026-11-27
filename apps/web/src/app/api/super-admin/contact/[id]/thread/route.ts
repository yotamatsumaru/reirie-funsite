/**
 * GET /api/super-admin/contact/[id]/thread — お問い合わせのやり取り (運営側チャット)
 *
 * SUPER_ADMIN と STAFF が閲覧できる。開いた (取得した) 時点で、
 * 会員からの追加メッセージを「運営が既読」にする (会員側に既読が付く)。
 */
import { NextResponse } from 'next/server';
import { requireSuperAdminView } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { loadThread, markThreadReadByAdmin, toChatMessages } from '@/lib/contact-thread';

export const runtime = 'nodejs';

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireSuperAdminView();
  const { id } = await ctx.params;
  const thread = await loadThread(id);
  if (!thread) throw errors.notFound('お問い合わせが見つかりません');

  const marked = await markThreadReadByAdmin(id);
  if (marked > 0) {
    const now = new Date();
    for (const r of thread.replies) if (r.sender === 'MEMBER' && !r.adminReadAt) r.adminReadAt = now;
  }

  return NextResponse.json(
    {
      thread: {
        id: thread.id,
        ticketNumber: thread.ticketNumber,
        subject: thread.subject,
        status: thread.status,
        isMember: Boolean(thread.userId),
      },
      messages: toChatMessages(thread, 'ADMIN'),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
