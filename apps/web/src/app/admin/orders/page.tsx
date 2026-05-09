import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatJpy } from '@/lib/pricing';

export const metadata: Metadata = { title: '注文管理' };
export const dynamic = 'force-dynamic';

export default async function AdminOrdersPage() {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { user: { select: { email: true, displayName: true } } },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-800">注文管理</h1>
      <Card>
        <CardBody className="p-0">
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
                    <Badge
                      tone={
                        o.status === 'PAID' || o.status === 'PROCESSING'
                          ? 'info'
                          : o.status === 'SHIPPED' || o.status === 'DELIVERED'
                            ? 'success'
                            : o.status === 'CANCELED' || o.status === 'REFUNDED'
                              ? 'danger'
                              : 'gray'
                      }
                    >
                      {o.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(o.createdAt).toLocaleString('ja-JP')}
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
