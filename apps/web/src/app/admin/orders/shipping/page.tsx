import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { requireCapabilityPage } from '@/auth';
import { ShippingClient } from './shipping-client';

export const metadata: Metadata = { title: '一括発送 (ヤマトB2)' };
export const dynamic = 'force-dynamic';

export default async function AdminOrderShippingPage() {
  await requireCapabilityPage('MERCH');

  const pendingCount = await prisma.order.count({
    where: { status: { in: ['PAID', 'PROCESSING'] } },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">一括発送 (ヤマトB2クラウド)</h1>
          <p className="mt-1 text-sm text-slate-500">
            未発送 {pendingCount} 件 ・ CSVで送り状データを出力→送り状番号を取り込み→一括発送通知
          </p>
        </div>
        <Link
          href="/admin/orders"
          className="text-sm text-brand-600 hover:underline"
        >
          ← 注文管理へ戻る
        </Link>
      </div>

      <ShippingClient />
    </div>
  );
}
