/**
 * GET /api/admin/orders/shipping/export
 *   - 未発送 (PAID / PROCESSING) の注文の配送先を、ヤマト B2クラウド「送り状発行」
 *     取込用CSV (UTF-8 BOM付き) でダウンロードする。
 *   - 送り状種類=発払い / クール区分=通常 を固定 (ユーザー確認済みのデフォルト)。
 *   - BASE 相当のワークフロー ①: このCSVを B2クラウドに取り込み → 送り状印刷 → 発送。
 *
 *   権限: MERCH (EC 運用担当)。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireCapability } from '@/auth';
import { handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { buildB2ExportCsv, type B2ExportOrder } from '@/lib/yamato-b2';

export const runtime = 'nodejs';

// 1回のエクスポートで出力する最大件数 (メモリ・応答時間の保護)
const EXPORT_LIMIT = 2000;

/** 品名の代表表記を作る (先頭商品名 + 複数なら "他") */
function representativeItemName(items: { productName: string }[]): string {
  if (items.length === 0) return '商品';
  const first = items[0].productName;
  return items.length > 1 ? `${first} 他` : first;
}

export const GET = handle(async (req: Request) => {
  const session = await requireCapability('MERCH');

  // 未発送で、発送作業の対象となる注文 (PAID / PROCESSING) を古い順に取得。
  // 古い注文から発送したいので createdAt asc。
  const orders = await prisma.order.findMany({
    where: { status: { in: ['PAID', 'PROCESSING'] } },
    include: { items: { select: { productName: true, quantity: true } } },
    orderBy: { createdAt: 'asc' },
    take: EXPORT_LIMIT,
  });

  const exportOrders: B2ExportOrder[] = orders.map((o) => ({
    orderNumber: o.orderNumber,
    shippingPostalCode: o.shippingPostalCode,
    shippingPrefecture: o.shippingPrefecture,
    shippingAddress1: o.shippingAddress1,
    shippingAddress2: o.shippingAddress2,
    shippingName: o.shippingName,
    shippingPhone: o.shippingPhone,
    itemName: representativeItemName(o.items),
    totalQuantity: o.items.reduce((sum, it) => sum + it.quantity, 0),
  }));

  const body = buildB2ExportCsv(exportOrders);

  await logAudit({
    userId: session.user.id,
    action: 'admin.order.shipping.export',
    resource: 'orders',
    userAgent: req.headers.get('user-agent') ?? undefined,
    metadata: { exported: exportOrders.length, truncated: orders.length >= EXPORT_LIMIT },
  });

  const filename = `yamato-b2-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
});
