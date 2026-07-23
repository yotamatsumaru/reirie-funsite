/**
 * GET /api/v1/auth/me — 現在の認証ユーザー情報と Pui 残高を返す
 *
 * 認証: Bearer トークン (Unity 等) または Cookie セッション (Web) のどちらでも可。
 * Unity 側でトークンの有効性確認・プロフィール取得に使う。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { handle } from '@/lib/errors';
import { requireApiPrincipal } from '@/lib/api-auth';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const principal = await requireApiPrincipal(req);

  let points = 0;
  let displayName: string | null = null;
  if (!env.demoMode) {
    const user = await prisma.user.findUnique({
      where: { id: principal.userId },
      select: { pui: true, displayName: true },
    });
    points = user?.pui ?? 0;
    displayName = user?.displayName ?? null;
  }

  return NextResponse.json({
    id: principal.userId,
    email: principal.email,
    displayName,
    role: principal.role,
    plan: principal.plan,
    points,
    authSource: principal.source,
  });
});
