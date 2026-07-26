/**
 * POST /api/super-admin/birthday/send
 *   誕生日メールを送信する。
 *   body: { year: number, userIds?: string[] }
 *     - userIds 指定: その会員のみ送信 (個別送信)。
 *     - userIds 省略/空: 「今日が誕生日で、その年に未送信」の全員へ一斉送信。
 *
 * SUPER_ADMIN 限定 (書き込み操作のため STAFF 不可)。
 */
import { NextResponse } from 'next/server';
import { BirthdayMailSendSchema } from '@idol/shared';
import { requireSuperAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { sendBirthdayMails } from '@/lib/birthday-mail';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireSuperAdmin();

  const parsed = BirthdayMailSendSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }
  const { year, userIds } = parsed.data;

  let result;
  try {
    result = await sendBirthdayMails({ year, userIds });
  } catch (e) {
    throw errors.badRequest(e instanceof Error ? e.message : '送信に失敗しました');
  }

  await logAudit({
    userId: session.user.id,
    action: 'birthday.send',
    resource: `birthday:${year}`,
    metadata: {
      year,
      mode: userIds && userIds.length > 0 ? 'individual' : 'bulk',
      ...result,
    },
  });

  return NextResponse.json({ ok: true, result });
});
