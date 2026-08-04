import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import {
  canAccess,
  MAX_VIDEO_QUALITY,
  allowedVideoQualities,
} from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { handle, errors } from '@/lib/errors';
import { signVideoUrl } from '@/lib/cdn-signer';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const session = await requireApiSession(req);
  const plan = session.user.plan;

  const video = await prisma.video.findUnique({ where: { id } });
  if (!video || video.status !== 'READY' || !video.s3HlsKey) {
    throw errors.notFound('動画が見つかりません');
  }
  if (video.expiresAt && video.expiresAt <= new Date()) {
    throw errors.forbidden('配信許諾期限が切れています');
  }
  if (!canAccess(plan, video.accessLevel)) {
    throw errors.planRequired(video.accessLevel === 'PREMIUM' ? 'プレミアム' : 'スタンダード');
  }

  const { url, expiresAt, signed } = signVideoUrl(video.s3HlsKey);
  if (!signed) {
    // CloudFront 署名設定 (ドメイン / キーペア / 秘密鍵) が未完了。
    // このまま URL を返しても CloudFront が 403 を返すため、明確に原因を伝える。
    throw errors.badRequest(
      '動画配信 (CloudFront 署名付き URL) が未設定です。CLOUDFRONT_VIDEO_DOMAIN / CLOUDFRONT_KEY_PAIR_ID / CLOUDFRONT_PRIVATE_KEY を設定してください。',
    );
  }
  const maxQuality = MAX_VIDEO_QUALITY[plan];
  const allowedQualities = allowedVideoQualities(plan);

  prisma.videoViewLog
    .create({
      data: {
        videoId: video.id,
        userId: session.user.id,
        userAgent: req.headers.get('User-Agent') ?? undefined,
      },
    })
    .catch(() => {});

  // クライアントは maxQuality に基づき HLS マスタープレイリストから該当 variant のみを選択
  // (将来的に nginx 側で variant playlist を返す実装も検討)
  return NextResponse.json({
    hlsUrl: url,
    expiresAt: expiresAt.toISOString(),
    plan,
    maxQuality,
    allowedQualities,
  });
});
