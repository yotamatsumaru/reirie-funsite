/**
 * POST /api/me/email/verify — 確認コードを入力してメールアドレス変更を確定する
 *
 * 成功すると users.email が新アドレスに切り替わる。
 * メールアドレスはログイン ID でもあるため、画面側では成功後に
 * 一度ログアウトして新しいアドレスで入り直してもらう案内を出す。
 */
import { NextResponse } from 'next/server';
import { VerifyEmailChangeSchema } from '@idol/shared';
import { handle, errors } from '@/lib/errors';
import { requireApiSession } from '@/lib/api-auth';
import { verifyEmailChange } from '@/lib/email-change';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const body = await req.json().catch(() => ({}));
  const parsed = VerifyEmailChangeSchema.safeParse(body);
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }

  const result = await verifyEmailChange({
    userId: session.user.id,
    code: parsed.data.code,
  });

  if (!result.ok) {
    switch (result.reason) {
      case 'EMAIL_TAKEN':
        throw errors.conflict(result.message);
      case 'TOO_MANY_ATTEMPTS':
        throw errors.rateLimited(result.message);
      default:
        throw errors.badRequest(result.message);
    }
  }

  return NextResponse.json({
    message: 'メールアドレスを変更しました',
    email: result.pendingEmail,
  });
});
