import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { VerifyEmailCodeSchema } from '@idol/shared';
import { handle, errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { MAX_VERIFICATION_ATTEMPTS } from '@/lib/verification-code';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const body = await req.json();
  const { email, code } = VerifyEmailCodeSchema.parse(body);

  const user = await prisma.user.findUnique({ where: { email } });
  // メールアドレスの存在有無を漏らさないよう、汎用的なエラーメッセージにする。
  if (!user) throw errors.badRequest('認証コードが正しくないか、有効期限が切れています');

  if (user.emailVerified) {
    return NextResponse.json({ message: 'メール認証は既に完了しています' });
  }

  if (
    !user.verificationCode ||
    !user.verificationCodeExpires ||
    user.verificationCodeExpires.getTime() < Date.now()
  ) {
    throw errors.badRequest('認証コードの有効期限が切れています。再送してください');
  }

  if (user.verificationAttempts >= MAX_VERIFICATION_ATTEMPTS) {
    throw errors.badRequest('認証コードの入力回数が上限に達しました。再送してください');
  }

  if (user.verificationCode !== code) {
    await prisma.user.update({
      where: { id: user.id },
      data: { verificationAttempts: { increment: 1 } },
    });
    throw errors.badRequest('認証コードが正しくありません');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: new Date(),
      verificationCode: null,
      verificationCodeExpires: null,
      verificationAttempts: 0,
      verificationToken: null,
    },
  });
  await logAudit({ userId: user.id, action: 'user.email_verified' });
  return NextResponse.json({ message: 'メール認証を完了しました' });
});
