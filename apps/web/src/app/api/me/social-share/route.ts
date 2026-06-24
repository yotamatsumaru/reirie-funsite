/**
 * POST /api/me/social-share — SNS シェアによるポイント付与 (X / Instagram)
 * GET  /api/me/social-share — 今日の各プラットフォームの受給状況
 *
 * 注意: X / Instagram のシェア完了をサーバーで自動検証する公式手段は
 *       (無料では) 無いため、「ユーザーがシェアした旨を報告 → 付与」方式とする。
 *       不正防止として 1 プラットフォーム 1 日 1 回に制限
 *       (SocialShareGrant の userId+date+platform UNIQUE 制約)。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { SocialShareInputSchema, SOCIAL_PLATFORMS, jstDateKey } from '@idol/shared';
import { requireSession } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getPointRates } from '@/lib/app-setting';
import { grantSocialShare } from '@/lib/points';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  const session = await requireSession();
  const today = jstDateKey();
  const grants = await prisma.socialShareGrant.findMany({
    where: { userId: session.user.id, date: today },
    select: { platform: true },
  });
  const claimed = new Set(grants.map((g) => g.platform));
  return NextResponse.json({
    date: today,
    platforms: SOCIAL_PLATFORMS.map((p) => ({
      platform: p,
      claimedToday: claimed.has(p),
    })),
  });
});

export const POST = handle(async (req: Request) => {
  const session = await requireSession();
  const body = SocialShareInputSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    throw errors.unprocessable('プラットフォームを指定してください', body.error.flatten());
  }

  const rates = await getPointRates();
  const result = await grantSocialShare(session.user.id, body.data.platform, rates);

  if (result.granted) {
    await logAudit({
      userId: session.user.id,
      action: 'points.social_share',
      resource: `user:${session.user.id}`,
      metadata: { platform: body.data.platform, amount: result.amount },
    });
  }

  return NextResponse.json(result);
});
