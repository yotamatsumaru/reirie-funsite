import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { canAccess } from '@idol/shared';
import { resolveApiSession } from '@/lib/api-auth';
import { handle } from '@/lib/errors';
import { resolveThumbnailUrls } from '@/lib/video-delivery';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const session = await resolveApiSession(req);
  const allowed: Array<'PUBLIC' | 'MEMBERS' | 'PREMIUM'> = ['PUBLIC'];
  if (canAccess(session?.user?.plan, 'MEMBERS')) allowed.push('MEMBERS');
  if (canAccess(session?.user?.plan, 'PREMIUM')) allowed.push('PREMIUM');

  const items = await prisma.video.findMany({
    where: {
      status: 'READY',
      publishedAt: { lte: new Date() },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      accessLevel: { in: allowed },
    },
    orderBy: { publishedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      description: true,
      thumbnailUrl: true,
      durationSeconds: true,
      accessLevel: true,
      publishedAt: true,
    },
  });
  // サムネイルは非公開バケット上の S3 キーなので署名付き URL に変換する
  // (CloudFront 署名鍵があればそれ、無ければ S3 プリサインドにフォールバック)
  const thumbs = await resolveThumbnailUrls(items.map((v) => v.thumbnailUrl));
  return NextResponse.json({
    items: items.map((v, i) => ({ ...v, thumbnailUrl: thumbs[i] ?? null })),
  });
});
