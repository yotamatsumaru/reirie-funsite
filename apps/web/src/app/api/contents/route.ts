import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { ListContentsQuerySchema, accessibleLevels } from '@idol/shared';
import { resolveApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';
import { getSiteSectionVisibility } from '@/lib/app-setting';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const { contentsVisible } = await getSiteSectionVisibility();
  if (!contentsVisible) throw errors.notFound('コンテンツは現在非公開です');

  const url = new URL(req.url);
  const query = ListContentsQuerySchema.parse({
    type: url.searchParams.get('type') ?? undefined,
    tag: url.searchParams.get('tag') ?? undefined,
    page: url.searchParams.get('page') ?? 1,
    limit: url.searchParams.get('limit') ?? 12,
  });
  const session = await resolveApiSession(req);

  // 公開範囲の段階を追加したときにここの列挙を直し忘れると、
  // その段階のコンテンツが誰にも表示されなくなるので共通関数から導出する。
  const allowed = accessibleLevels(session?.user?.plan);

  const where = {
    status: 'PUBLISHED' as const,
    ...(query.type ? { type: query.type } : {}),
    ...(query.tag ? { tags: { has: query.tag } } : {}),
    accessLevel: { in: allowed },
  };

  const [items, total] = await Promise.all([
    prisma.content.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        type: true,
        slug: true,
        title: true,
        excerpt: true,
        coverImageUrl: true,
        accessLevel: true,
        publishedAt: true,
        authorName: true,
        tags: true,
        viewCount: true,
      },
    }),
    prisma.content.count({ where }),
  ]);

  return NextResponse.json({
    items,
    page: query.page,
    limit: query.limit,
    total,
    hasMore: query.page * query.limit < total,
  });
});
