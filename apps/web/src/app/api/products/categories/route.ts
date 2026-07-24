/**
 * GET /api/products/categories
 *  - 商品カテゴリツリー
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { errors, handle } from '@/lib/errors';
import { getSiteSectionVisibility } from '@/lib/app-setting';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  const { productsVisible } = await getSiteSectionVisibility();
  if (!productsVisible) throw errors.notFound('商品は現在非公開です');

  const cats = await prisma.productCategory.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      parentId: true,
      sortOrder: true,
    },
  });
  return NextResponse.json({ items: cats });
});
