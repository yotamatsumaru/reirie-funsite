/**
 * GET /api/shipping-methods
 *  - 公開: 有効な配送方法の一覧 (商品ページで「配送方法 / 送料」を表示するため)
 */
import { NextResponse } from 'next/server';
import { handle } from '@/lib/errors';
import { listActiveShippingMethods } from '@/lib/shipping';

export const runtime = 'nodejs';

export const GET = handle(async () => {
  const items = await listActiveShippingMethods();
  return NextResponse.json({
    items: items.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      fee: m.fee,
      isDefault: m.isDefault,
    })),
  });
});
