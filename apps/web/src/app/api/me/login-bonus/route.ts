/**
 * POST /api/me/login-bonus — 毎日のログインボーナスを受け取る
 * GET  /api/me/login-bonus — 今日の受給状況を取得
 *
 * 二重付与防止: LoginBonusGrant (userId, date[JST]) UNIQUE 制約。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { jstDateKey } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getPuiRates } from '@/lib/app-setting';
import { grantLoginBonus } from '@/lib/points';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const today = jstDateKey();
  const [grant, user] = await Promise.all([
    prisma.loginBonusGrant.findUnique({
      where: { userId_date: { userId: session.user.id, date: today } },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { pui: true },
    }),
  ]);
  return NextResponse.json({
    date: today,
    claimedToday: Boolean(grant),
    streak: grant?.streak ?? 0,
    amount: grant?.amount ?? 0,
    balance: user?.pui ?? 0,
  });
});

export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const rates = await getPuiRates();
  const result = await grantLoginBonus(session.user.id, rates);

  if (result.granted) {
    await logAudit({
      userId: session.user.id,
      action: 'points.login_bonus',
      resource: `user:${session.user.id}`,
      metadata: { amount: result.amount, streak: result.streak },
    });
  }

  return NextResponse.json(result);
});
