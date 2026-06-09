import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { prisma } from '@idol/db';
import { ForgotPasswordSchema } from '@idol/shared';
import { handle } from '@/lib/errors';
import { sendEmail } from '@/lib/email';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const body = await req.json();
  const { email } = ForgotPasswordSchema.parse(body);

  const user = await prisma.user.findUnique({ where: { email } });
  // 列挙攻撃を避けるため常に成功レスポンス
  if (user) {
    const token = randomBytes(24).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1時間
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetToken: token, passwordResetExpires: expires },
    });
    const url = `${env.appBaseUrl}/reset-password?token=${token}`;
    await sendEmail({
      to: user.email,
      subject: '【ファンクラブ】パスワード再設定',
      text: `パスワード再設定の依頼を受け付けました。\n以下のURLから新しいパスワードを設定してください (1時間有効)。\n${url}`,
    });
  }
  return NextResponse.json({
    message: '入力されたメールアドレスにパスワード再設定の案内を送信しました',
  });
});
