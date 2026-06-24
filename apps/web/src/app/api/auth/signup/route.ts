import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { prisma } from '@idol/db';
import { SignUpSchema } from '@idol/shared';
import { hashPassword } from '@/lib/password';
import { handle, errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { sendEmail } from '@/lib/email';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const body = await req.json();
  const input = SignUpSchema.parse(body);

  const exists = await prisma.user.findUnique({ where: { email: input.email } });
  if (exists) throw errors.conflict('このメールアドレスは既に登録されています');

  const verificationToken = randomBytes(24).toString('hex');
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash: hashPassword(input.password),
      displayName: input.displayName,
      fullName: input.fullName,
      phone: input.phone,
      birthDate: new Date(input.birthDate),
      postalCode: input.postalCode,
      prefecture: input.prefecture,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2 ?? null,
      marketingOptIn: input.marketingOptIn ?? false,
      verificationToken,
    },
  });

  await logAudit({ userId: user.id, action: 'user.signup' });

  const verifyUrl = `${env.appBaseUrl}/verify-email?token=${verificationToken}`;
  await sendEmail({
    to: user.email,
    subject: '【ファンクラブ】メールアドレスの確認',
    text: `ご登録ありがとうございます。\n以下のURLからメール認証を完了してください。\n${verifyUrl}\n\nこのURLは24時間有効です。`,
  });

  return NextResponse.json({
    message: '確認メールを送信しました。メール内のリンクからメール認証を完了してください。',
    userId: user.id,
  });
});
