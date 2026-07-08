import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { canAccess } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { handle, errors } from '@/lib/errors';
import { signLivePlaybackUrl } from '@/lib/ivs';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const session = await requireApiSession(req);

  const live = await prisma.liveStream.findUnique({ where: { id } });
  if (!live || live.status === 'CANCELED' || live.status === 'ENDED') {
    throw errors.notFound('配信が見つかりません');
  }
  if (!canAccess(session.user.plan, live.accessLevel)) {
    throw errors.planRequired(live.accessLevel === 'PREMIUM' ? 'プレミアム' : 'スタンダード');
  }

  // Private Channel のみ署名付きURLを返却
  const { url, expiresAt } = live.isPrivate
    ? signLivePlaybackUrl(live.ivsPlaybackUrl)
    : { url: live.ivsPlaybackUrl, expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000) };

  return NextResponse.json({ playbackUrl: url, expiresAt: expiresAt.toISOString() });
});
