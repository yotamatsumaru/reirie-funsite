/**
 * GET  /api/admin/categories - 全カテゴリ
 * POST /api/admin/categories - 作成
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { CreateCategorySchema } from '@idol/shared';
import { requireAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireAdmin();
  const items = await prisma.productCategory.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      _count: { select: { products: true } },
    },
  });
  return NextResponse.json({ items });
});

export const POST = handle(async (req: Request) => {
  const session = await requireAdmin();
  const body = CreateCategorySchema.parse(await req.json());

  const exists = await prisma.productCategory.findUnique({ where: { slug: body.slug } });
  if (exists) throw errors.conflict('同じ slug のカテゴリが既に存在します');

  if (body.parentId) {
    const parent = await prisma.productCategory.findUnique({ where: { id: body.parentId } });
    if (!parent) throw errors.badRequest('親カテゴリが見つかりません');
  }

  const created = await prisma.productCategory.create({
    data: {
      slug: body.slug,
      name: body.name,
      description: body.description,
      parentId: body.parentId,
      sortOrder: body.sortOrder,
    },
  });

  await logAudit({
    userId: session.user.id,
    action: 'admin.category.created',
    resource: `category:${created.id}`,
    metadata: { slug: created.slug },
  });

  return NextResponse.json(created, { status: 201 });
});
