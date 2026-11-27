/**
 * POST /api/super-admin/contact/[id]/reply
 *   お問い合わせへ運営から返信する (SUPER_ADMIN / STAFF)。
 *   - 返信を保存し、問い合わせ者へメール通知する。
 *   - markResolved=true (既定) なら対応状況を「対応済み」に更新する。
 *   - 送信者がログイン会員の場合、マイページのお問い合わせ (チャット) にも表示される。
 *   - STAFF (スタッフ管理者) も返信できる (staff-permissions.test.ts の許可リスト参照)。
 *
 * メール送信に失敗しても返信レコードは残す (emailSent=false)。その場合も 200 を返し、
 * レスポンスの emailSent / emailError で結果を通知する (管理画面で再送判断できる)。
 */
import { NextResponse } from 'next/server';
import { ContactReplySchema } from '@idol/shared';
import { requireSuperAdminOrStaff } from '@/auth';
import { handle, errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { createContactReply } from '@/lib/contact-reply';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireSuperAdminOrStaff();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const input = ContactReplySchema.parse(body);

  let result;
  try {
    result = await createContactReply({
      contactMessageId: id,
      body: input.body,
      repliedById: session.user.id,
      markResolved: input.markResolved,
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'お問い合わせが見つかりません') {
      throw errors.notFound(e.message);
    }
    throw e;
  }

  await logAudit({
    userId: session.user.id,
    action: 'contact.reply',
    resource: 'contact_messages',
    userAgent: req.headers.get('user-agent') ?? undefined,
    metadata: {
      contactId: id,
      replyId: result.reply.id,
      emailSent: result.emailSent,
      markResolved: input.markResolved,
    },
  });

  return NextResponse.json({
    ok: true,
    id: result.reply.id,
    emailSent: result.emailSent,
    emailError: result.emailError,
    createdAt: result.reply.createdAt.toISOString(),
  });
});
