/**
 * GET  /api/admin/products - 全商品 (非公開含む)
 * POST /api/admin/products - 商品作成 (variants は別エンドポイントで追加)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { CreateProductSchema, ListProductsQuerySchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import type { Prisma } from '@idol/db';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  await requireCapability('MERCH');
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

/** 商品名から slug の基礎部分を生成（日本語等で空になる場合は 'item'） */
function slugBase(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'item';
}

/** 一意な slug を生成（衝突したら短いランダムサフィックスを付与） */
async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugBase(name).slice(0, 60);
  // まずは base そのままを試す
  if (!(await prisma.product.findUnique({ where: { slug: base } }))) {
    return base;
  }
  for (let i = 0; i < 8; i++) {
    const suffix = Math.random().toString(36).slice(2, 7);
    const candidate = `${base}-${suffix}`;
    if (!(await prisma.product.findUnique({ where: { slug: candidate } }))) {
      return candidate;
    }
  }
  // 最終手段: タイムスタンプ
  return `${base}-${Date.now().toString(36)}`;
}

export const POST = handle(async (req: Request) => {
  const session = await requireCapability('MERCH');
  const body = CreateProductSchema.parse(await req.json());

  // slug はサーバー側で自動生成（リクエストの slug は無視して常に名前から生成）
  const slug = await generateUniqueSlug(body.name);

  if (body.categoryId) {
    const cat = await prisma.productCategory.findUnique({ where: { id: body.categoryId } });
    if (!cat) throw errors.badRequest('カテゴリが見つかりません');
  }

  const created = await prisma.product.create({
    data: {
      slug,
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
