/**
 * POST /api/me/contact-reply/read
 *   マイページで運営からの返信 (お知らせ) を開いたときに既読化する。
 *   body: { replyId: string }
 *
 * 本人が受け取った返信のみ既読にできる (contactMessage.userId で絞り込み)。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handle, errors } from '@/lib/errors';
import { requireApiSession } from '@/lib/api-auth';
import { markContactReplyRead } from '@/lib/contact-reply';

export const runtime = 'nodejs';

const Schema = z.object({ replyId: z.uuid() });

export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw errors.badRequest('replyId が不正です');

  await markContactReplyRead({
    userId: session.user.id,
    replyId: parsed.data.replyId,
  });

  return NextResponse.json({ ok: true });
});
