import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { canAccess } from '@idol/shared';
import { resolveApiSession } from '@/lib/api-auth';
import { handle, errors } from '@/lib/errors';
import { resolveThumbnailUrl } from '@/lib/cdn-signer';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const video = await prisma.video.findUnique({ where: { id } });
  if (!video || video.status !== 'READY') throw errors.notFound();

  const session = await resolveApiSession(req);
  if (!canAccess(session?.user?.plan, video.accessLevel)) {
    if (!session?.user) throw errors.unauthorized();
    throw errors.planRequired(video.accessLevel === 'PREMIUM' ? 'プレミアム' : 'スタンダード');
  }

  return NextResponse.json({
    id: video.id,
    title: video.title,
    description: video.description,
    // 非公開バケット上の S3 キーは CloudFront 署名付き URL に変換して返す
    thumbnailUrl: resolveThumbnailUrl(video.thumbnailUrl),
    durationSeconds: video.durationSeconds,
    accessLevel: video.accessLevel,
  });
});
