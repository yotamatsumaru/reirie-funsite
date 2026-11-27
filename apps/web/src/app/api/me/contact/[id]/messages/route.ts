/**
 * POST /api/me/contact/[id]/messages — 自分のお問い合わせに追加メッセージを送る
 *
 * body: { body: string }
 *
 * - 本人のお問い合わせのみ (他人のものは 404)。クローズ済みは 403。
 * - 「対応済み」のものに送ると「対応中」に戻り、運営の未対応バッジに再び出る。
 * - 運営へメール通知する (未読の追加メッセージがすでにある間は重ねて送らない)。
 */
import { NextResponse } from 'next/server';
import { ContactMemberMessageSchema } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { postMemberMessage } from '@/lib/contact-thread';
import { notifyAdminsOfMemberMessage } from '@/lib/contact-notify';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireApiSession(req);
  const { id } = await ctx.params;
  const input = ContactMemberMessageSchema.parse(await req.json().catch(() => null));

  const result = await postMemberMessage({
    userId: session.user.id,
    contactId: id,
    body: input.body,
  });

  if (result.notifyAdmins) {
    // 通知の失敗はメッセージの成立に影響させない (関数内で例外を握る)
    await notifyAdminsOfMemberMessage({
      contactId: result.thread.id,
      ticketNumber: result.thread.ticketNumber,
      subject: result.thread.subject,
      name: result.thread.name,
      email: result.thread.email,
      memberNumber: result.thread.memberNumber,
      body: input.body,
    });
  }

  await logAudit({
    userId: session.user.id,
    action: 'contact.member_message',
    resource: 'contact_messages',
    userAgent: req.headers.get('user-agent') ?? undefined,
    metadata: { contactId: id, replyId: result.message.id },
  });

  return NextResponse.json({ ok: true, message: result.message, status: result.status }, { status: 201 });
});
