import type { Metadata } from 'next';
import Link from 'next/link';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@idol/db';
import { PLAN_LABELS } from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatJpy } from '@/lib/pricing';
import { ManageSubscriptionButtons } from '@/components/auth/ManageSubscriptionButtons';

export const metadata: Metadata = { title: 'マイページ' };
export const dynamic = 'force-dynamic';

export default async function MePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/me');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      subscriptions: {
        where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  const orders = await prisma.order.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      totalAmount: true,
      createdAt: true,
    },
  });

  const sub = user?.subscriptions[0];

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">マイページ</h1>
        <p className="mt-1 text-sm text-slate-500">{user?.email}</p>
      </header>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">会員プラン</h2>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-3">
            <Badge tone={session.user.plan === 'PREMIUM' ? 'brand' : session.user.plan === 'STANDARD' ? 'info' : 'gray'}>
              {PLAN_LABELS[session.user.plan]}
            </Badge>
            {sub && (
              <span className="text-sm text-slate-600">
                {sub.billingInterval === 'YEAR' ? '年額' : '月額'} / 状態:{' '}
                {sub.status === 'ACTIVE' ? '有効' : sub.status}
              </span>
            )}
          </div>
          {sub?.currentPeriodEnd && (
            <p className="text-sm text-slate-500">
              次回更新日: {new Date(sub.currentPeriodEnd).toLocaleDateString('ja-JP')}
            </p>
          )}
          <ManageSubscriptionButtons hasActiveSub={Boolean(sub)} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">最近の注文</h2>
            <Link href="/me/orders" className="text-sm text-brand-600 hover:underline">
              全て見る
            </Link>
          </div>
        </CardHeader>
        <CardBody>
          {orders.length === 0 ? (
            <p className="text-sm text-slate-500">注文履歴はまだありません</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-mono text-sm text-slate-700">{o.orderNumber}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(o.createdAt).toLocaleString('ja-JP')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-800">
                      {formatJpy(o.totalAmount)}
                    </p>
                    <Badge tone={o.status === 'PAID' ? 'success' : 'gray'}>{o.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">クイックリンク</h2>
        </CardHeader>
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Link href="/contents" className="rounded-md border border-slate-200 px-4 py-3 hover:border-brand-500">
            限定コンテンツ
          </Link>
          <Link href="/products" className="rounded-md border border-slate-200 px-4 py-3 hover:border-brand-500">
            グッズショップ
          </Link>
          <Link href="/me/tickets" className="rounded-md border border-slate-200 px-4 py-3 hover:border-brand-500">
            チケット連携
          </Link>
          <Link href="/me/orders" className="rounded-md border border-slate-200 px-4 py-3 hover:border-brand-500">
            注文履歴
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
