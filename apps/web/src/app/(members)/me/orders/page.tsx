/**
 * /me/orders — 購入履歴 (注文一覧)
 *
 * マイページの「最近の注文」カードから「全て見る」で遷移するページ。
 * これまでリンク先が存在せず 404 になっていたバグの修正として新設。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@idol/db';
import { ORDER_STATUS_LABELS } from '@idol/shared';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatJpy } from '@/lib/pricing';

export const metadata: Metadata = { title: '購入履歴 | マイページ' };
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<keyof typeof ORDER_STATUS_LABELS, 'gray' | 'success' | 'warning' | 'danger'> = {
  PENDING: 'warning',
  PAID: 'success',
  PROCESSING: 'success',
  SHIPPED: 'success',
  DELIVERED: 'success',
  CANCELED: 'gray',
  REFUNDED: 'danger',
};

export default async function MeOrdersPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/me/orders');

  const orders = await prisma.order.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      totalAmount: true,
      createdAt: true,
      items: { select: { productName: true, variantName: true, quantity: true } },
    },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">購入履歴</h1>
          <p className="mt-1 text-sm text-slate-500">
            グッズ・特典等のご注文履歴です。全 {orders.length} 件
          </p>
        </div>
        <Link href="/me" className="text-sm text-brand-600 hover:underline">
          ← マイページへ戻る
        </Link>
      </header>

      <Card>
        <CardBody className="p-0">
          {orders.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">注文履歴はまだありません</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {orders.map((o) => (
                <li key={o.id}>
                  <Link
                    href={`/me/orders/${o.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 hover:bg-slate-50 sm:px-6"
                  >
                    <div>
                      <p className="font-mono text-sm text-slate-700">{o.orderNumber}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {new Date(o.createdAt).toLocaleString('ja-JP')}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {o.items
                          .slice(0, 2)
                          .map((it) => it.productName)
                          .join(' / ')}
                        {o.items.length > 2 ? ` 他${o.items.length - 2}点` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-semibold text-slate-800">
                        {formatJpy(o.totalAmount)}
                      </p>
                      <Badge tone={STATUS_TONE[o.status as keyof typeof ORDER_STATUS_LABELS] ?? 'gray'}>
                        {ORDER_STATUS_LABELS[o.status as keyof typeof ORDER_STATUS_LABELS] ?? o.status}
                      </Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
