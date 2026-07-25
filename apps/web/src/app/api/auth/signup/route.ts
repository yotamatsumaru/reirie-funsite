import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { SignUpSchema } from '@idol/shared';
import { hashPassword } from '@/lib/password';
import { handle, errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { ensureMemberNumber } from '@/lib/points';
import { sendVerificationCodeEmail } from '@/lib/email';
import { generateVerificationCode, verificationCodeExpiryDate, VERIFICATION_CODE_TTL_MINUTES } from '@/lib/verification-code';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const body = await req.json();
  const input = SignUpSchema.parse(body);

  const exists = await prisma.user.findUnique({ where: { email: input.email } });
  if (exists) throw errors.conflict('このメールアドレスは既に登録されています');

  const verificationCode = generateVerificationCode();
  const verificationCodeExpires = verificationCodeExpiryDate();
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
      verificationCode,
      verificationCodeExpires,
      verificationAttempts: 0,
    },
  });

  await logAudit({ userId: user.id, action: 'user.signup' });

  // 会員番号を登録時点で採番する (全プラン共通)。
  // 会員カードを開いていないユーザーに番号が付かない問題を防ぐため、ここで確実に付与する。
  // 採番は外部依存の無い DB 内トランザクションだが、万一失敗してもアカウント作成は
  // 成功として扱う (後から会員カード表示・一括採番でフォローできる)。
  try {
    await ensureMemberNumber(user.id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[signup] member number assignment failed', err);
    await logAudit({
      userId: user.id,
      action: 'user.signup_member_number_failed',
      metadata: { reason: err instanceof Error ? err.message : 'unknown' },
    });
  }

  // メール認証コードを送信する。
  // メール送信は外部 (SES) 依存のため、失敗してもアカウント作成自体は成功とする。
  // (アカウントは emailVerified が設定されるまでログインできないため、
  //  送信に失敗した場合は「認証コード再送」から再送してもらう導線を用意する)
  let emailSent = true;
  try {
    await sendVerificationCodeEmail({
      to: user.email,
      displayName: user.displayName ?? '',
      code: verificationCode,
      expiresInMinutes: VERIFICATION_CODE_TTL_MINUTES,
    });
  } catch (err) {
    emailSent = false;
    // eslint-disable-next-line no-console
    console.error('[signup] verification code email failed', err);
    await logAudit({
      userId: user.id,
      action: 'user.signup_email_failed',
      metadata: { reason: err instanceof Error ? err.message : 'unknown' },
    });
  }

  return NextResponse.json({
    message: emailSent
      ? '認証コードをメールで送信しました。メールに記載の6桁のコードを入力してください。'
      : 'アカウントを作成しました。認証コードの送信に失敗したため、コードの再送をお試しください。',
    userId: user.id,
    email: user.email,
    emailSent,
  });
});
