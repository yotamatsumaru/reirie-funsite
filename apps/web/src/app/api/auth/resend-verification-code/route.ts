import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { ResendVerificationCodeSchema } from '@idol/shared';
import { handle, errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import {
  generateVerificationCode,
  verificationCodeExpiryDate,
  VERIFICATION_CODE_TTL_MINUTES,
  RESEND_COOLDOWN_SECONDS,
} from '@/lib/verification-code';
import { sendVerificationCodeEmail } from '@/lib/email';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const body = await req.json();
  const { email } = ResendVerificationCodeSchema.parse(body);

  const user = await prisma.user.findUnique({ where: { email } });
  // メールアドレスの存在有無を漏らさないよう、存在しない場合も成功レスポンスにする。
  if (!user) {
    return NextResponse.json({ message: '認証コードを送信しました（対象のアドレスの場合）' });
  }
  if (user.emailVerified) {
    return NextResponse.json({ message: 'メール認証は既に完了しています' });
  }

  // クールダウン: 直前に発行したコードの有効期限から逆算し、発行直後の連打を防ぐ。
  if (user.verificationCodeExpires) {
    const issuedAt = user.verificationCodeExpires.getTime() - VERIFICATION_CODE_TTL_MINUTES * 60 * 1000;
    const elapsedSeconds = (Date.now() - issuedAt) / 1000;
    if (elapsedSeconds < RESEND_COOLDOWN_SECONDS) {
      throw errors.rateLimited('しばらく待ってから再送してください');
    }
  }

  const verificationCode = generateVerificationCode();
  const verificationCodeExpires = verificationCodeExpiryDate();
  await prisma.user.update({
    where: { id: user.id },
    data: { verificationCode, verificationCodeExpires, verificationAttempts: 0 },
  });

  try {
    await sendVerificationCodeEmail({
      to: user.email,
      displayName: user.displayName ?? '',
      code: verificationCode,
      expiresInMinutes: VERIFICATION_CODE_TTL_MINUTES,
    });
  } catch (err) {
    console.error('[resend-verification-code] email failed', err);
    await logAudit({
      userId: user.id,
      action: 'user.resend_verification_email_failed',
      metadata: { reason: err instanceof Error ? err.message : 'unknown' },
    });
    throw errors.internal('認証コードの送信に失敗しました');
  }

  await logAudit({ userId: user.id, action: 'user.resend_verification_code' });
  return NextResponse.json({ message: '認証コードを再送しました' });
});
