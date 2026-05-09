import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { ResetPasswordSchema } from '@idol/shared';
import { handle, errors } from '@/lib/errors';
import { hashPassword } from '@/lib/password';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const body = await req.json();
  const input = ResetPasswordSchema.parse(body);

  const user = await prisma.user.findUnique({
    where: { passwordResetToken: input.token },
  });
  if (
    !user ||
    !user.passwordResetExpires ||
    user.passwordResetExpires.getTime() < Date.now()
  ) {
    throw errors.badRequest('トークンが無効か、有効期限が切れています');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPassword(input.newPassword),
      passwordResetToken: null,
      passwordResetExpires: null,
    },
  });
  await logAudit({ userId: user.id, action: 'user.password_reset' });
  return NextResponse.json({ message: 'パスワードを再設定しました' });
});
