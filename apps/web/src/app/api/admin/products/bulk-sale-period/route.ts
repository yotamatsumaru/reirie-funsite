/**
 * POST /api/admin/products/bulk-sale-period
 *  - 複数商品の販売期間 (発売開始 / 終了) を一括設定する (一斉発売用)
 *  - activate=true なら同時に isActive=true にする
 *
 * これにより「10/20 21:00 に 5 商品を同時発売」が
 * 一度の操作で予約でき、時刻になれば自動で購入可能になる。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { BulkSalePeriodSchema, validateSalePeriod } from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireCapability('MERCH');
  const body = BulkSalePeriodSchema.parse(await req.json());

  const invalid = validateSalePeriod(body.saleStartsAt, body.saleEndsAt);
  if (invalid) throw errors.badRequest(invalid);

  const result = await prisma.product.updateMany({
    where: { id: { in: body.productIds } },
    data: {
      saleStartsAt: body.saleStartsAt ? new Date(body.saleStartsAt) : null,
      saleEndsAt: body.saleEndsAt ? new Date(body.saleEndsAt) : null,
      ...(body.activate ? { isActive: true } : {}),
    },
  });

  await logAudit({
    userId: session.user.id,
    action: 'admin.product.bulk_sale_period',
    resource: 'products',
    metadata: {
      count: result.count,
      saleStartsAt: body.saleStartsAt,
      saleEndsAt: body.saleEndsAt,
      activate: body.activate,
    },
  });

  return NextResponse.json({ updated: result.count });
});
