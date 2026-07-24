import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { canAccess } from '@idol/shared';
import { resolveApiSession } from '@/lib/api-auth';
import { handle, errors } from '@/lib/errors';
import { getSiteSectionVisibility } from '@/lib/app-setting';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const { contentsVisible } = await getSiteSectionVisibility();
  if (!contentsVisible) throw errors.notFound('記事が見つかりません');

  const { slug } = await ctx.params;
  const session = await resolveApiSession(req);

  const content = await prisma.content.findUnique({
    where: { slug },
    include: { images: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!content || content.status !== 'PUBLISHED') {
    throw errors.notFound('記事が見つかりません');
  }
  if (!canAccess(session?.user?.plan, content.accessLevel)) {
    if (!session?.user) throw errors.unauthorized();
    throw errors.planRequired(content.accessLevel === 'PREMIUM' ? 'プレミアム' : 'スタンダード');
  }

  // 閲覧数カウント (best-effort)
  prisma.content
    .update({ where: { id: content.id }, data: { viewCount: { increment: 1 } } })
    .catch(() => {});

  return NextResponse.json(content);
});
