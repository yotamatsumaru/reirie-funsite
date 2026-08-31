/**
 * 登録メールアドレスの変更 API (会員本人用)
 *
 *   GET    /api/me/email … 現在のアドレスと、手続き中の申請の有無を返す
 *   POST   /api/me/email … 変更を申請する (パスワード確認 → 新アドレスへコード送信)
 *   DELETE /api/me/email … 手続き中の申請を取り消す
 *
 * 確定 (コード入力) は /api/me/email/verify で行う。
 */
import { NextResponse } from 'next/server';
import { RequestEmailChangeSchema } from '@idol/shared';
import { handle, errors } from '@/lib/errors';
import { requireApiSession } from '@/lib/api-auth';
import { verifyPassword } from '@/lib/password';
import { env } from '@/lib/env';
import {
  getEmailChangeStatus,
  requestEmailChange,
  cancelEmailChange,
  type EmailChangeFailureReason,
} from '@/lib/email-change';

export const runtime = 'nodejs';

/**
 * 失敗理由を HTTP ステータスに対応づける。
 * 画面側でメッセージを出し分けられるよう、理由コードもそのまま返す。
 */
function toApiError(reason: EmailChangeFailureReason, message: string): never {
  switch (reason) {
    case 'INVALID_PASSWORD':
      throw errors.badRequest(message);
    case 'SAME_EMAIL':
      throw errors.badRequest(message);
    case 'EMAIL_TAKEN':
      throw errors.conflict(message);
    case 'COOLING_DOWN':
      throw errors.rateLimited(message);
    case 'NO_PENDING':
      throw errors.badRequest(message);
    case 'EXPIRED':
      throw errors.badRequest(message);
    case 'TOO_MANY_ATTEMPTS':
      throw errors.rateLimited(message);
    case 'INVALID_CODE':
      throw errors.badRequest(message);
    case 'SEND_FAILED':
      throw errors.internal(message);
  }
}

export const GET = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const status = await getEmailChangeStatus(session.user.id);
  if (!status) throw errors.notFound();
  return NextResponse.json(
    {
      currentEmail: status.currentEmail,
      pendingEmail: status.pendingEmail,
      expiresAt: status.expiresAt?.toISOString() ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const body = await req.json().catch(() => ({}));
  const parsed = RequestEmailChangeSchema.safeParse(body);
  if (!parsed.success) {
    throw errors.unprocessable('入力値が不正です', parsed.error.flatten());
  }

  const result = await requestEmailChange({
    userId: session.user.id,
    newEmail: parsed.data.newEmail,
    password: parsed.data.password,
    // デモモードではパスワード検証をスキップする (DELETE /api/me と同じ方針)。
    verifyPasswordFn: env.demoMode ? () => true : verifyPassword,
  });

  if (!result.ok) toApiError(result.reason, result.message);

  return NextResponse.json({
    message: '確認コードを送信しました',
    pendingEmail: result.pendingEmail,
    expiresAt: result.expiresAt.toISOString(),
  });
});

export const DELETE = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  await cancelEmailChange(session.user.id);
  return NextResponse.json({ message: '変更手続きを取り消しました' });
});
