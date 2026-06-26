/**
 * POST /api/v1/auth/token/refresh — refresh トークンで access トークンを再発行する
 *
 * リクエスト: { "refreshToken": "..." }
 * レスポンス: { accessToken, refreshToken, tokenType: "Bearer", expiresIn }
 *
 * セキュリティ: refresh トークンの署名・期限・種別を検証したうえで、
 * 最新の DB 上の role / plan を読み直して access トークンに反映する
 * (権限の昇格/降格やプラン変更を確実に反映させるため)。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { normalizeAdminCapabilities } from '@idol/shared';
import type { PlanTypeLiteral, UserRoleLiteral } from '@idol/shared';
import { handle, errors } from '@/lib/errors';
import { verifyApiToken, issueTokenPair } from '@/lib/api-token';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const body = (await req.json().catch(() => null)) as { refreshToken?: unknown } | null;
  const refreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken : null;
  if (!refreshToken) {
    throw errors.badRequest('refreshToken を指定してください');
  }

  const payload = await verifyApiToken(refreshToken, 'refresh');
  if (!payload?.sub) {
    throw errors.unauthorized('リフレッシュトークンが無効または期限切れです');
  }
  const userId = payload.sub;

  // デモモードでは DB を引かずトークンを再発行
  if (env.demoMode) {
    const tokens = await issueTokenPair({
      sub: userId,
      email: (payload.email as string) ?? '',
      role: ((payload.role as UserRoleLiteral) ?? 'USER'),
      plan: ((payload.plan as PlanTypeLiteral) ?? 'FREE'),
      capabilities: [],
    });
    return NextResponse.json(tokens);
  }

  // 最新の権限・プランを読み直す
  const user = await prisma.user.findUnique({
    where: { id: userId, deletedAt: null },
    include: {
      subscriptions: {
        where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });
  if (!user) {
    throw errors.unauthorized('ユーザーが見つかりません');
  }

  const plan: PlanTypeLiteral = user.subscriptions[0]
    ? (user.subscriptions[0].planType as PlanTypeLiteral)
    : 'FREE';

  const tokens = await issueTokenPair({
    sub: user.id,
    email: user.email,
    role: user.role as UserRoleLiteral,
    plan,
    capabilities: normalizeAdminCapabilities(user.adminCapabilities),
  });

  return NextResponse.json(tokens);
});
