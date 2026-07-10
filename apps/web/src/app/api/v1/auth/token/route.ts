/**
 * POST /api/v1/auth/token — email + password で API トークンを発行する
 *
 * Unity / モバイル / 外部クライアント向け。Web の Cookie セッションとは独立。
 * 成功時 access / refresh トークンを返す。以後 `Authorization: Bearer <access>` で
 * 各 API を呼ぶ。access の期限が切れたら /api/v1/auth/token/refresh で再発行する。
 *
 * リクエスト: { "email": "...", "password": "..." }
 * レスポンス: { accessToken, refreshToken, tokenType: "Bearer", expiresIn, user }
 */
import { NextResponse } from 'next/server';
import { SignInSchema } from '@idol/shared';
import { handle, errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { authenticateCredentials } from '@/lib/credentials';
import { issueTokenPair } from '@/lib/api-token';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const body = await req.json().catch(() => null);
  const parsed = SignInSchema.safeParse(body);
  if (!parsed.success) {
    throw errors.badRequest('メールアドレスとパスワードを正しく指定してください');
  }

  const result = await authenticateCredentials(parsed.data.email, parsed.data.password);
  if (!result.ok) {
    if (result.reason === 'ACCOUNT_LOCKED') {
      throw errors.rateLimited(
        'ログイン試行回数が多いため、一時的にアカウントをロックしています。しばらく待ってから再度お試しください。',
      );
    }
    if (result.reason === 'EMAIL_NOT_VERIFIED') {
      throw errors.forbidden('メール認証が完了していません。認証コードを入力してください。');
    }
    // 認証失敗はアカウントの存在を漏らさないため一律 401
    throw errors.unauthorized('メールアドレスまたはパスワードが正しくありません');
  }
  const user = result.user;

  const tokens = await issueTokenPair({
    sub: user.id,
    email: user.email,
    role: user.role,
    plan: user.plan,
    capabilities: user.capabilities,
  });

  await logAudit({
    userId: user.id,
    action: 'auth.api_token_issued',
    resource: `user:${user.id}`,
    metadata: { via: 'password' },
  });

  return NextResponse.json({
    ...tokens,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      plan: user.plan,
    },
  });
});
