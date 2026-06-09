/**
 * GET /api/products/categories
 *  - 商品カテゴリツリー
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async () => {
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
