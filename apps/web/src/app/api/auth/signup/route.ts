import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { prisma } from '@idol/db';
import { SignUpSchema } from '@idol/shared';
import { hashPassword } from '@/lib/password';
import { handle, errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { sendWelcomeEmail } from '@/lib/email';
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

  // ウェルカム & メール認証メールを送信する。
  // メール送信は外部 (SES) 依存のため、失敗してもアカウント作成自体は成功とする。
  // (ユーザーは後からログインしてメール再送できる導線を用意する想定)
  const verifyUrl = `${env.appBaseUrl}/verify-email?token=${verificationToken}`;
  let emailSent = true;
  try {
    await sendWelcomeEmail({
      to: user.email,
      displayName: user.displayName ?? '',
      verifyUrl,
    });
  } catch (err) {
    emailSent = false;
    // eslint-disable-next-line no-console
    console.error('[signup] welcome email failed', err);
    await logAudit({
      userId: user.id,
      action: 'user.signup_email_failed',
      metadata: { reason: err instanceof Error ? err.message : 'unknown' },
    });
  }

  return NextResponse.json({
    message: emailSent
      ? '確認メールを送信しました。メール内のリンクからメール認証を完了してください。'
      : 'アカウントを作成しました。確認メールの送信に失敗したため、ログイン後に再送してください。',
    userId: user.id,
    emailSent,
  });
});
