/**
 * /me/orders — 購入履歴 (注文一覧)
 *
 * マイページの「最近の注文」カードから「全て見る」で遷移するページ。
 * これまでリンク先が存在せず 404 になっていたバグの修正として新設。
 *
 * 【2026-07 拡張】EC 注文 (グッズ) に加えて、サブスクリプション (プラン) の
 * 課金履歴もここに統合して表示するようにした。表示用の正規化・マージは
 * @/lib/order-history の getUnifiedOrderHistory に委譲する。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, formatJstDateTime } from '@idol/shared';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatJpy } from '@/lib/pricing';
import { getUnifiedOrderHistory } from '@/lib/order-history';

export const metadata: Metadata = { title: '購入履歴 | マイページ' };
export const dynamic = 'force-dynamic';

const ORDER_STATUS_TONE: Record<keyof typeof ORDER_STATUS_LABELS, 'gray' | 'success' | 'warning' | 'danger'> = {
  PENDING: 'warning',
  PAID: 'success',
  PROCESSING: 'success',
  SHIPPED: 'success',
  DELIVERED: 'success',
  CANCELED: 'gray',
  REFUNDED: 'danger',
};

const PAYMENT_STATUS_TONE: Record<keyof typeof PAYMENT_STATUS_LABELS, 'gray' | 'success' | 'warning' | 'danger'> = {
  PENDING: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  REFUNDED: 'danger',
};

export default async function MeOrdersPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/me/orders');

  const entries = await getUnifiedOrderHistory(session.user.id, 100);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">購入履歴</h1>
          <p className="mt-1 text-sm text-slate-500">
            グッズ・プランのご注文/お支払い履歴です。全 {entries.length} 件
          </p>
        </div>
        <Link href="/me" className="text-sm text-brand-600 hover:underline">
          ← マイページへ戻る
        </Link>
      </header>

      <Card>
        <CardBody className="p-0">
          {entries.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">購入履歴はまだありません</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {entries.map((entry) => {
                if (entry.type === 'ORDER') {
                  return (
                    <li key={`order-${entry.id}`}>
                      <Link
                        href={`/me/orders/${entry.id}`}
                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 hover:bg-slate-50 sm:px-6"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <Badge tone="brand">EC注文</Badge>
                            <p className="font-mono text-sm text-slate-700">{entry.documentNumber}</p>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {formatJstDateTime(entry.createdAt)}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">{entry.summaryLabel}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-base font-semibold text-slate-800">
                            {formatJpy(entry.amount)}
                          </p>
                          <Badge
                            tone={
                              ORDER_STATUS_TONE[entry.status as keyof typeof ORDER_STATUS_LABELS] ??
                              'gray'
                            }
                          >
                            {ORDER_STATUS_LABELS[entry.status as keyof typeof ORDER_STATUS_LABELS] ??
                              entry.status}
                          </Badge>
                        </div>
                      </Link>
                    </li>
                  );
                }
                return (
                  <li key={`sub-${entry.id}`}>
                    <Link
                      href={`/me/orders/subscription/${entry.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 hover:bg-slate-50 sm:px-6"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge tone="info">サブスク</Badge>
                          <p className="text-sm text-slate-700">
                            {entry.planLabel
                              ? `${entry.planLabel} プラン${entry.intervalLabel ? ` (${entry.intervalLabel})` : ''}`
                              : 'サブスクリプション'}
                          </p>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {formatJstDateTime(entry.createdAt)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-base font-semibold text-slate-800">
                          {formatJpy(entry.amount)}
                        </p>
                        <Badge
                          tone={
                            PAYMENT_STATUS_TONE[entry.status as keyof typeof PAYMENT_STATUS_LABELS] ??
                            'gray'
                          }
                        >
                          {PAYMENT_STATUS_LABELS[entry.status as keyof typeof PAYMENT_STATUS_LABELS] ??
                            entry.status}
                        </Badge>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
