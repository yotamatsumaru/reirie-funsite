/**
 * POST /api/me/birthday-mail/read
 *   マイページで誕生日メールを開いたときに既読化する。
 *   body: { deliveryId: string }
 *
 * 本人の配信記録のみ既読にできる (userId で絞り込み)。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handle, errors } from '@/lib/errors';
import { requireApiSession } from '@/lib/api-auth';
import { markBirthdayMailRead } from '@/lib/birthday-mail';

export const runtime = 'nodejs';

const Schema = z.object({ deliveryId: z.uuid() });

export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw errors.badRequest('deliveryId が不正です');

  await markBirthdayMailRead({
    userId: session.user.id,
    deliveryId: parsed.data.deliveryId,
  });

  return NextResponse.json({ ok: true });
});
