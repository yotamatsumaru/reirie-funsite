import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatJpy } from '@/lib/pricing';
import { requireCapabilityPage } from '@/auth';
import { formatJstDateTime } from '@idol/shared';

export const metadata: Metadata = { title: '注文管理' };
export const dynamic = 'force-dynamic';

export default async function AdminOrdersPage() {
  await requireCapabilityPage('MERCH');
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { user: { select: { email: true, displayName: true } } },
  });

  const tone = (status: string) =>
    status === 'PAID' || status === 'PROCESSING'
      ? 'info'
      : status === 'SHIPPED' || status === 'DELIVERED'
        ? 'success'
        : status === 'CANCELED' || status === 'REFUNDED'
          ? 'danger'
          : 'gray';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">注文管理</h1>
        <Link
          href="/admin/orders/shipping"
          className="inline-flex items-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          一括発送 (ヤマトB2)
        </Link>
      </div>

      {/* モバイル: カードリスト */}
      <div className="space-y-3 md:hidden">
        {orders.length === 0 ? (
          <Card>
            <CardBody className="text-center text-sm text-slate-500">注文はありません</CardBody>
          </Card>
        ) : (
          orders.map((o) => (
            <Card key={o.id}>
              <CardBody className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/admin/orders/${o.id}`}
                    className="font-mono text-xs text-brand-600 hover:underline"
                  >
                    {o.orderNumber}
                  </Link>
                  <Badge tone={tone(o.status)}>{o.status}</Badge>
                </div>
                <p className="truncate text-sm text-slate-700">
                  {o.user?.displayName ?? o.user?.email}
                </p>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">
                    {formatJstDateTime(o.createdAt)}
                  </span>
                  <span className="text-sm font-semibold text-slate-800">
                    {formatJpy(o.totalAmount)}
                  </span>
                </div>
              </CardBody>
            </Card>
          ))
        )}
      </div>

      {/* デスクトップ: テーブル */}
      <Card className="hidden md:block">
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">注文番号</th>
                <th className="px-4 py-3">顧客</th>
                <th className="px-4 py-3">金額</th>
                <th className="px-4 py-3">状態</th>
                <th className="px-4 py-3">日時</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link href={`/admin/orders/${o.id}`} className="text-brand-600 hover:underline">
                      {o.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{o.user?.displayName ?? o.user?.email}</td>
                  <td className="px-4 py-3">{formatJpy(o.totalAmount)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={tone(o.status)}>{o.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {formatJstDateTime(o.createdAt)}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    注文はありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
