import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { canAccess } from '@idol/shared';
import { requireSession } from '@/auth';
import { handle, errors } from '@/lib/errors';
import { signVideoUrl } from '@/lib/cdn-signer';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const session = await requireSession();

  const video = await prisma.video.findUnique({ where: { id } });
  if (!video || video.status !== 'READY' || !video.s3HlsKey) {
    throw errors.notFound('動画が見つかりません');
  }
  if (video.expiresAt && video.expiresAt <= new Date()) {
    throw errors.forbidden('配信許諾期限が切れています');
  }
  if (!canAccess(session.user.plan, video.accessLevel)) {
    throw errors.planRequired(video.accessLevel === 'PREMIUM' ? 'プレミアム' : 'スタンダード');
  }

  const { url, expiresAt } = signVideoUrl(video.s3HlsKey);

  prisma.videoViewLog
    .create({
      data: {
        videoId: video.id,
        userId: session.user.id,
        userAgent: req.headers.get('User-Agent') ?? undefined,
      },
    })
    .catch(() => {});

  return NextResponse.json({ hlsUrl: url, expiresAt: expiresAt.toISOString() });
});
