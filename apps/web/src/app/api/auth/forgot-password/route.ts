import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { prisma } from '@idol/db';
import { ForgotPasswordSchema } from '@idol/shared';
import { handle, errors } from '@/lib/errors';
import { sendEmail } from '@/lib/email';
import { env } from '@/lib/env';
import {
  PASSWORD_RESET_TTL_MINUTES,
  PASSWORD_RESET_RESEND_COOLDOWN_SECONDS,
  passwordResetExpiryDate,
} from '@/lib/password-reset';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const body = await req.json();
  const { email } = ForgotPasswordSchema.parse(body);

  const user = await prisma.user.findUnique({ where: { email } });
  // 列挙攻撃を避けるため常に成功レスポンス
  if (user) {
    // クールダウン: 直前に発行したトークンの有効期限から逆算し、連打による
    // メール送信の濫用 (スパム/DoS) を防ぐ。列挙攻撃を避けるため、対象ユーザーが
    // 存在する場合のみ内部的にチェックし、レスポンス自体は常に同じ成功メッセージにする。
    if (user.passwordResetExpires) {
      const issuedAt =
        user.passwordResetExpires.getTime() - PASSWORD_RESET_TTL_MINUTES * 60 * 1000;
      const elapsedSeconds = (Date.now() - issuedAt) / 1000;
      if (elapsedSeconds < PASSWORD_RESET_RESEND_COOLDOWN_SECONDS) {
        throw errors.rateLimited('しばらく待ってから再度お試しください');
      }
    }

    const token = randomBytes(24).toString('hex');
    const expires = passwordResetExpiryDate();
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetToken: token, passwordResetExpires: expires },
    });
    const url = `${env.appBaseUrl}/reset-password?token=${token}`;
    await sendEmail({
      to: user.email,
      subject: '【ファンクラブ】パスワード再設定',
      text: `パスワード再設定の依頼を受け付けました。\n以下のURLから新しいパスワードを設定してください (${PASSWORD_RESET_TTL_MINUTES / 60}時間有効)。\n${url}`,
    });
  }
  return NextResponse.json({
    message: '入力されたメールアドレスにパスワード再設定の案内を送信しました',
  });
});
