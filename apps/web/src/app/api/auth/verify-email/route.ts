import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { VerifyEmailSchema } from '@idol/shared';
import { handle, errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const body = await req.json();
  const { token } = VerifyEmailSchema.parse(body);

  const user = await prisma.user.findUnique({ where: { verificationToken: token } });
  if (!user) throw errors.badRequest('トークンが不正です');

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: new Date(), verificationToken: null },
  });
  await logAudit({ userId: user.id, action: 'user.email_verified' });
  return NextResponse.json({ message: 'メール認証を完了しました' });
});
