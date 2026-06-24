/**
 * GET    /api/admin/contents/[id] - 詳細
 * PATCH  /api/admin/contents/[id] - 更新
 * DELETE /api/admin/contents/[id] - 削除 (実削除)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { UpdateContentSchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const GET = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    await requireCapability('CONTENT');
    const { id } = await ctx.params;
    const content = await prisma.content.findUnique({
      where: { id },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!content) throw errors.notFound('コンテンツが見つかりません');
    return NextResponse.json(content);
  },
);

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('CONTENT');
    const { id } = await ctx.params;
    const body = UpdateContentSchema.parse(await req.json());

    const exists = await prisma.content.findUnique({ where: { id } });
    if (!exists) throw errors.notFound('コンテンツが見つかりません');

    // slug 変更時の重複チェック
    if (body.slug && body.slug !== exists.slug) {
      const dup = await prisma.content.findUnique({ where: { slug: body.slug } });
      if (dup) throw errors.conflict('同じ slug が既に存在します');
    }

    // PUBLISHED へ初遷移時は publishedAt を自動セット
    let publishedAt = exists.publishedAt;
    if (body.status === 'PUBLISHED' && !exists.publishedAt) {
      publishedAt = body.publishedAt ? new Date(body.publishedAt) : new Date();
    } else if (body.publishedAt) {
      publishedAt = new Date(body.publishedAt);
    }

    const updated = await prisma.content.update({
      where: { id },
      data: {
        ...(body.type ? { type: body.type } : {}),
        ...(body.slug ? { slug: body.slug } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.excerpt !== undefined ? { excerpt: body.excerpt } : {}),
        ...(body.body !== undefined ? { body: body.body } : {}),
        ...(body.coverImageUrl !== undefined ? { coverImageUrl: body.coverImageUrl } : {}),
        ...(body.accessLevel ? { accessLevel: body.accessLevel } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.authorName !== undefined ? { authorName: body.authorName } : {}),
        ...(body.tags ? { tags: body.tags } : {}),
        publishedAt,
      },
    });

    // imageUrls が指定された場合は画像を入れ替え
    if (body.imageUrls) {
      await prisma.contentImage.deleteMany({ where: { contentId: id } });
      if (body.imageUrls.length > 0) {
        await prisma.contentImage.createMany({
          data: body.imageUrls.map((url, i) => ({ contentId: id, url, sortOrder: i })),
        });
      }
    }

    await logAudit({
      userId: session.user.id,
      action: 'admin.content.updated',
      resource: `content:${id}`,
      metadata: { changes: Object.keys(body) },
    });

    return NextResponse.json(updated);
  },
);

export const DELETE = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('CONTENT');
    const { id } = await ctx.params;
    const exists = await prisma.content.findUnique({ where: { id } });
    if (!exists) throw errors.notFound('コンテンツが見つかりません');
    await prisma.content.delete({ where: { id } });
    await logAudit({
      userId: session.user.id,
      action: 'admin.content.deleted',
      resource: `content:${id}`,
    });
    return NextResponse.json({ deleted: true });
  },
);
