/**
 * GET  /api/admin/products - 全商品 (非公開含む)
 * POST /api/admin/products - 商品作成 (variants は別エンドポイントで追加)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { CreateProductSchema, ListProductsQuerySchema } from '@idol/shared';
import { requireAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import type { Prisma } from '@idol/db';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  await requireAdmin();
  const url = new URL(req.url);
  const query = ListProductsQuerySchema.parse({
    category: url.searchParams.get('category') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: url.searchParams.get('page') ?? 1,
    limit: url.searchParams.get('limit') ?? 30,
  });

  const where: Prisma.ProductWhereInput = {
    ...(query.category ? { category: { slug: query.category } } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { slug: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        category: { select: { id: true, slug: true, name: true } },
        images: { orderBy: { sortOrder: 'asc' }, take: 1 },
        variants: {
          select: {
            id: true,
            sku: true,
            name: true,
            isActive: true,
            inventory: { select: { quantity: true, reserved: true, safetyStock: true } },
          },
        },
      },
    }),
    prisma.product.count({ where }),
  ]);

  return NextResponse.json({ items, page: query.page, limit: query.limit, total });
});

export const POST = handle(async (req: Request) => {
  const session = await requireAdmin();
  const body = CreateProductSchema.parse(await req.json());

  const exists = await prisma.product.findUnique({ where: { slug: body.slug } });
  if (exists) throw errors.conflict('同じ slug の商品が既に存在します');

  if (body.categoryId) {
    const cat = await prisma.productCategory.findUnique({ where: { id: body.categoryId } });
    if (!cat) throw errors.badRequest('カテゴリが見つかりません');
  }

  const created = await prisma.product.create({
    data: {
      slug: body.slug,
      name: body.name,
      description: body.description,
      basePrice: body.basePrice,
      memberPrice: body.memberPrice,
      premiumPrice: body.premiumPrice,
      categoryId: body.categoryId,
      isActive: body.isActive,
      isMembersOnly: body.isMembersOnly,
      isPremiumExclusive: body.isPremiumExclusive,
    },
  });

  await logAudit({
    userId: session.user.id,
    action: 'admin.product.created',
    resource: `product:${created.id}`,
    metadata: { slug: created.slug },
  });

  return NextResponse.json(created, { status: 201 });
});
