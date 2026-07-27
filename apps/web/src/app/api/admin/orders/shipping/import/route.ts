/**
 * POST /api/admin/orders/shipping/import
 *   - ヤマト B2クラウドが出力した「発送予定データ」CSV (お客様管理番号 + 送り状番号)
 *     のテキストを受け取り、注文番号 (orderNumber) で自社の注文に突き合わせて
 *     「発送確定プレビュー」を返す (この時点では DB は更新しない)。
 *   - BASE 相当のワークフロー ②: 送り状番号を未発送注文に一括で紐づける前段。
 *
 *   リクエスト: { csv: string }  (アップロードしたCSVファイルの中身)
 *   レスポンス:
 *     {
 *       matched:   [{ orderNumber, trackingNumber, orderId, status, shippingName,
 *                     alreadyShipped, shippable }],
 *       unmatched: [{ orderNumber, trackingNumber }],   // 注文が見つからない
 *       skipped:   number[],                            // CSV上で管理番号/送り状番号が欠落した行
 *       parseError?: string,
 *     }
 *
 *   権限: MERCH。
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@idol/db';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { parseB2TrackingCsv } from '@/lib/yamato-b2';

export const runtime = 'nodejs';

const ImportBodySchema = z.object({
  csv: z.string().min(1).max(5_000_000), // 5MB 上限 (概算)
});

export const POST = handle(async (req: Request) => {
  await requireCapability('MERCH');
  const { csv } = ImportBodySchema.parse(await req.json());

  const parsed = parseB2TrackingCsv(csv);
  if (parsed.error) {
    throw errors.unprocessable(parsed.error);
  }

  // CSV 内の重複管理番号を排除 (最後の送り状番号を優先) しつつ、突き合わせ対象を確定。
  const byOrderNumber = new Map<string, string>();
  for (const r of parsed.rows) {
    byOrderNumber.set(r.orderNumber, r.trackingNumber);
  }
  const orderNumbers = Array.from(byOrderNumber.keys());

  const orders =
    orderNumbers.length > 0
      ? await prisma.order.findMany({
          where: { orderNumber: { in: orderNumbers } },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            shippingName: true,
            trackingNumber: true,
          },
        })
      : [];

  const orderMap = new Map(orders.map((o) => [o.orderNumber, o]));

  const matched: {
    orderNumber: string;
    trackingNumber: string;
    orderId: string;
    status: string;
    shippingName: string;
    alreadyShipped: boolean;
    shippable: boolean;
  }[] = [];
  const unmatched: { orderNumber: string; trackingNumber: string }[] = [];

  for (const [orderNumber, trackingNumber] of byOrderNumber) {
    const o = orderMap.get(orderNumber);
    if (!o) {
      unmatched.push({ orderNumber, trackingNumber });
      continue;
    }
    const shippable = o.status === 'PAID' || o.status === 'PROCESSING';
    const alreadyShipped =
      o.status === 'SHIPPED' || o.status === 'DELIVERED';
    matched.push({
      orderNumber,
      trackingNumber,
      orderId: o.id,
      status: o.status,
      shippingName: o.shippingName,
      alreadyShipped,
      shippable,
    });
  }

  return NextResponse.json({
    matched,
    unmatched,
    skipped: parsed.skipped,
  });
});
