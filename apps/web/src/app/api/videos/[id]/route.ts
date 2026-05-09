import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { canAccess } from '@idol/shared';
import { auth } from '@/auth';
import { handle, errors } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const video = await prisma.video.findUnique({ where: { id } });
  if (!video || video.status !== 'READY') throw errors.notFound();

  const session = await auth();
  if (!canAccess(session?.user?.plan, video.accessLevel)) {
    if (!session?.user) throw errors.unauthorized();
    throw errors.planRequired(video.accessLevel === 'PREMIUM' ? 'プレミアム' : 'スタンダード');
  }

  return NextResponse.json({
    id: video.id,
    title: video.title,
    description: video.description,
    thumbnailUrl: video.thumbnailUrl,
    durationSeconds: video.durationSeconds,
    accessLevel: video.accessLevel,
  });
});
