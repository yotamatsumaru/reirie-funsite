/**
 * POST /api/me/social-share — SNS シェアによるポイント付与 (X のみ)
 * GET  /api/me/social-share — 今日の各プラットフォームの受給状況
 *
 * (Instagram シェアは 2026-07 に廃止。SOCIAL_PLATFORMS は X のみを含み、
 *  SocialShareInputSchema も INSTAGRAM を拒否する。過去の付与記録は保持する。)
 *
 * 注意: X のシェア完了をサーバーで自動検証する公式手段は
 *       (無料では) 無いため、「シェアボタンを開いた記録 (intent) → 一定時間後に
 *       受取 (claim)」の 2 段階方式とする。intent が無い / 待機不足のときは
 *       受取を拒否し、「シェアせずに受取だけ押す」不正をサーバー側で防ぐ。
 *       さらに 1 プラットフォーム 1 日 1 回に制限
 *       (SocialShareGrant の userId+date+platform UNIQUE 制約)。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { SocialShareInputSchema, SOCIAL_PLATFORMS, jstDateKey } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getPuiRates } from '@/lib/app-setting';
import { grantSocialShare, recordSocialShareIntent } from '@/lib/points';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const today = jstDateKey();
  const [grants, intents] = await Promise.all([
    prisma.socialShareGrant.findMany({
      where: { userId: session.user.id, date: today },
      select: { platform: true },
    }),
    prisma.socialShareIntent.findMany({
      where: { userId: session.user.id, date: today },
      select: { platform: true },
    }),
  ]);
  const claimed = new Set(grants.map((g) => g.platform));
  const intended = new Set(intents.map((i) => i.platform));
  return NextResponse.json({
    date: today,
    platforms: SOCIAL_PLATFORMS.map((p) => ({
      platform: p,
      claimedToday: claimed.has(p),
      // 当日シェアボタンを開いた記録があるか (未受取のときのみ意味を持つ)
      sharedToday: intended.has(p),
    })),
  });
});

export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const body = SocialShareInputSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    throw errors.unprocessable('プラットフォームを指定してください', body.error.flatten());
  }

  const platform = body.data.platform;
  // action 省略時は後方互換のため 'claim' とみなす。
  const action = body.data.action ?? 'claim';

  // --- ステップ1: シェア意図の記録 (シェアボタンを開いた瞬間に呼ばれる) ---
  if (action === 'intent') {
    const res = await recordSocialShareIntent(session.user.id, platform);
    await logAudit({
      userId: session.user.id,
      action: 'points.social_share_intent',
      resource: `user:${session.user.id}`,
      metadata: { platform },
    });
    return NextResponse.json(res);
  }

  // --- ステップ2: 受取 (intent が無い / 待機不足なら拒否) ---
  const rates = await getPuiRates();
  const result = await grantSocialShare(session.user.id, platform, rates);

  if (result.granted) {
    await logAudit({
      userId: session.user.id,
      action: 'points.social_share',
      resource: `user:${session.user.id}`,
      metadata: { platform, amount: result.amount },
    });
    return NextResponse.json(result);
  }

  // 意図が無い / 待機不足は 409 で理由を返す (UI で案内する)
  if (!result.alreadyGranted && 'reason' in result) {
    if (result.reason === 'no_intent') {
      throw errors.unprocessable(
        'まず「シェア」ボタンから投稿してください。投稿後に受け取れます。',
      );
    }
    if (result.reason === 'too_soon') {
      throw errors.unprocessable(
        'シェアの確認中です。数秒おいてからもう一度お試しください。',
      );
    }
  }

  return NextResponse.json(result);
});
