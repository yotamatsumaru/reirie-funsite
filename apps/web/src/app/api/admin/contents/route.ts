/**
 * GET  /api/admin/contents  - 全コンテンツ一覧 (DRAFT/ARCHIVED 含む)
 * POST /api/admin/contents  - コンテンツ作成
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import {
  AdminListContentsQuerySchema,
  CreateContentSchema,
} from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { sanitizeContentBody } from '@/lib/sanitize-html';
import { buildGalleryImages } from '@/lib/gallery-images';
import { normalizeAlbumName } from '@/lib/gallery-album';
import type { Prisma } from '@idol/db';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  await requireCapability('CONTENT');
  const url = new URL(req.url);
  const query = AdminListContentsQuerySchema.parse({
    status: url.searchParams.get('status') ?? undefined,
    type: url.searchParams.get('type') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: url.searchParams.get('page') ?? 1,
    limit: url.searchParams.get('limit') ?? 30,
  });

  const where: Prisma.ContentWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.q
      ? {
          OR: [
            { title: { contains: query.q, mode: 'insensitive' as const } },
            { slug: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.content.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
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

export const POST = handle(async (req: Request) => {
  const session = await requireCapability('CONTENT');
  const body = CreateContentSchema.parse(await req.json());

  const exists = await prisma.content.findUnique({ where: { slug: body.slug } });
  if (exists) throw errors.conflict('同じ slug のコンテンツが既に存在します');

  const galleryImages = buildGalleryImages(body.imageUrls, body.imageCaptions);

  const created = await prisma.content.create({
    data: {
      type: body.type,
      slug: body.slug,
      title: body.title,
      excerpt: body.excerpt,
      body: sanitizeContentBody(body.body),
      coverImageUrl: body.coverImageUrl,
      accessLevel: body.accessLevel,
      status: body.status,
      publishedAt:
        body.status === 'PUBLISHED'
          ? body.publishedAt
            ? new Date(body.publishedAt)
            : new Date()
          : body.publishedAt
            ? new Date(body.publishedAt)
            : null,
      authorName: body.authorName,
      tags: body.tags,
      /**
       * アルバム名。
       * 前後の空白を落とし、空になったら null (未設定) にする。
       * 空文字をそのまま保存すると、一覧で空白のタブが並ぶ
       * (詳細は lib/gallery-album.ts)。
       */
      album: normalizeAlbumName(body.album),
      // ギャラリー画像。共有スキーマは string を受けるだけなので、
      // 危険なスキーム (javascript: など) の排除・重複除去・上限は
      // ここで normalizeGalleryImageUrls が担う。
      ...(galleryImages.length > 0
        ? {
            images: {
              create: galleryImages.map((img, i) => ({
                url: img.url,
                caption: img.caption,
                sortOrder: i,
              })),
            },
          }
        : {}),
    },
  });

  await logAudit({
    userId: session.user.id,
    action: 'admin.content.created',
    resource: `content:${created.id}`,
    metadata: { slug: created.slug },
  });

  return NextResponse.json(created, { status: 201 });
});
