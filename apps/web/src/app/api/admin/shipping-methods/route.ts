/**
 * GET  /api/admin/shipping-methods - 配送方法一覧 (無効含む)
 * POST /api/admin/shipping-methods - 配送方法作成
 *
 * BASE の「送料詳細設定 App」相当。ネコポス / 宅急便コンパクト / 宅急便 など
 * 商品のサイズに応じた配送方法を登録し、商品ごとに割り当てる。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { ShippingMethodInputSchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  await requireCapability('MERCH');
  const items = await prisma.shippingMethod.findMany({
    orderBy: [{ sortOrder: 'asc' }, { fee: 'asc' }],
    include: { _count: { select: { products: true } } },
  });
  return NextResponse.json({
    items: items.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      fee: m.fee,
      isDefault: m.isDefault,
      isActive: m.isActive,
      sortOrder: m.sortOrder,
      b2InvoiceType: m.b2InvoiceType,
      productCount: m._count.products,
    })),
  });
});

export const POST = handle(async (req: Request) => {
  const session = await requireCapability('MERCH');
  const body = ShippingMethodInputSchema.parse(await req.json());
  const created = await prisma.shippingMethod.create({
    data: {
      name: body.name,
      description: body.description ?? null,
      fee: body.fee,
      isDefault: body.isDefault,
      isActive: body.isActive,
      sortOrder: body.sortOrder,
      b2InvoiceType: body.b2InvoiceType ?? null,
    },
  });
  await logAudit({
    userId: session.user.id,
    action: 'admin.shipping_method.created',
    resource: `shipping_method:${created.id}`,
    metadata: { name: created.name, fee: created.fee },
  });
  return NextResponse.json(created, { status: 201 });
});
