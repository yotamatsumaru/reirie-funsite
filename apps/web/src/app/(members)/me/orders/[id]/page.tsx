/**
 * /me/orders/[id] — 購入履歴の注文詳細
 *  - 注文内容 (商品・数量・金額)・配送先・決済状況を表示
 *  - 支払明細書 (PDF) のダウンロードボタンを提供 (/api/me/orders/[id]/invoice)
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@idol/db';
import { ORDER_STATUS_LABELS } from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatJpy } from '@/lib/pricing';

export const metadata: Metadata = { title: '注文詳細 | マイページ' };
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

function formatDateTime(d: Date): string {
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function MeOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/me/orders');
  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: true,
      payments: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, amount: true, createdAt: true, receiptUrl: true },
      },
    },
  });

  // 他人の注文は見せない (見つからない場合と同じ 404 にすることで存在有無も漏らさない)
  if (!order || order.userId !== session.user.id) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/me/orders" className="text-sm text-brand-600 hover:underline">
            ← 購入履歴へ戻る
          </Link>
          <h1 className="mt-2 font-mono text-xl font-bold text-slate-800">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-slate-500">{formatDateTime(order.createdAt)}</p>
        </div>
        <a
          href={`/api/me/orders/${order.id}/invoice`}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          支払明細書をダウンロード (PDF)
        </a>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">注文状況</h2>
            <Badge tone={STATUS_TONE[order.status as keyof typeof ORDER_STATUS_LABELS] ?? 'gray'}>
              {ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS] ?? order.status}
            </Badge>
          </div>
        </CardHeader>
        <CardBody className="space-y-1 text-sm text-slate-600">
          {order.paidAt && <p>お支払い日時: {formatDateTime(order.paidAt)}</p>}
          {order.shippedAt && <p>発送日時: {formatDateTime(order.shippedAt)}</p>}
          {order.deliveredAt && <p>お届け日時: {formatDateTime(order.deliveredAt)}</p>}
          {order.canceledAt && <p>キャンセル日時: {formatDateTime(order.canceledAt)}</p>}
          {order.trackingNumber && <p>配送追跡番号: {order.trackingNumber}</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">ご注文内容</h2>
        </CardHeader>
        <CardBody className="p-0">
          <ul className="divide-y divide-slate-100">
            {order.items.map((it) => (
              <li key={it.id} className="flex items-center justify-between px-4 py-3 sm:px-6">
                <div>
                  <p className="text-sm font-medium text-slate-800">{it.productName}</p>
                  <p className="text-xs text-slate-500">
                    {it.variantName} × {it.quantity}
                  </p>
                </div>
                <p className="text-sm font-semibold text-slate-800">{formatJpy(it.subtotal)}</p>
              </li>
            ))}
          </ul>
          <div className="space-y-1 border-t border-slate-100 px-4 py-4 text-sm sm:px-6">
            <div className="flex justify-between text-slate-600">
              <span>小計</span>
              <span>{formatJpy(order.subtotal)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>消費税</span>
              <span>{formatJpy(order.taxAmount)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>配送料</span>
              <span>{formatJpy(order.shippingFee)}</span>
            </div>
            {order.discountAmount > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>割引</span>
                <span>-{formatJpy(order.discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
              <span>合計</span>
              <span>{formatJpy(order.totalAmount)}</span>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">お届け先</h2>
        </CardHeader>
        <CardBody className="text-sm text-slate-600">
          <p>{order.shippingName} 様</p>
          <p>
            〒{order.shippingPostalCode} {order.shippingPrefecture}
            {order.shippingAddress1}
            {order.shippingAddress2 ?? ''}
          </p>
          <p>TEL: {order.shippingPhone}</p>
        </CardBody>
      </Card>

      {order.payments.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">決済履歴</h2>
          </CardHeader>
          <CardBody className="p-0">
            <ul className="divide-y divide-slate-100">
              {order.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-4 py-3 text-sm sm:px-6">
                  <div>
                    <p className="text-slate-700">{formatDateTime(p.createdAt)}</p>
                    <p className="text-xs text-slate-500">{p.status}</p>
                  </div>
                  <p className="font-semibold text-slate-800">{formatJpy(p.amount)}</p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
