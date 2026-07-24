/**
 * /me/orders/subscription/[paymentId] — 購入履歴のサブスク課金詳細
 *  - サブスク (プラン) の課金内容・状況を表示
 *  - 支払明細書 (PDF) のダウンロードボタンを提供
 *    (/api/me/orders/subscription/[paymentId]/invoice)
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@idol/db';
import { PAYMENT_STATUS_LABELS, PLAN_LABELS, type PlanTypeLiteral } from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatJpy } from '@/lib/pricing';

export const metadata: Metadata = { title: 'サブスクお支払い詳細 | マイページ' };
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<keyof typeof PAYMENT_STATUS_LABELS, 'gray' | 'success' | 'warning' | 'danger'> = {
  PENDING: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'danger',
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

function formatDate(d: Date): string {
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default async function MeSubscriptionPaymentDetailPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/me/orders');
  const { paymentId } = await params;

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      subscription: {
        select: {
          planType: true,
          billingInterval: true,
          status: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          stripeSubscriptionId: true,
        },
      },
    },
  });

  // 他人の決済・サブスク以外の決済は見せない (存在有無も漏らさないよう 404 に統一)
  if (!payment || payment.userId !== session.user.id || payment.kind !== 'SUBSCRIPTION') {
    notFound();
  }

  const planType = (payment.subscription?.planType ?? 'STANDARD') as PlanTypeLiteral;
  const planLabel = PLAN_LABELS[planType] ?? planType;
  const intervalLabel = payment.subscription?.billingInterval === 'YEAR' ? '年額' : '月額';

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/me/orders" className="text-sm text-brand-600 hover:underline">
            ← 購入履歴へ戻る
          </Link>
          <h1 className="mt-2 text-xl font-bold text-slate-800">{planLabel} プラン ({intervalLabel})</h1>
          <p className="mt-1 text-sm text-slate-500">{formatDateTime(payment.createdAt)}</p>
        </div>
        <a
          href={`/api/me/orders/subscription/${payment.id}/invoice`}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          支払明細書をダウンロード (PDF)
        </a>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">お支払い状況</h2>
            <Badge tone={STATUS_TONE[payment.status as keyof typeof PAYMENT_STATUS_LABELS] ?? 'gray'}>
              {PAYMENT_STATUS_LABELS[payment.status as keyof typeof PAYMENT_STATUS_LABELS] ??
                payment.status}
            </Badge>
          </div>
        </CardHeader>
        <CardBody className="space-y-1 text-sm text-slate-600">
          <p>お申込み/課金日時: {formatDateTime(payment.createdAt)}</p>
          {payment.status === 'SUCCEEDED' && <p>お支払い日時: {formatDateTime(payment.createdAt)}</p>}
          {payment.subscription && (
            <p>
              対象期間: {formatDate(payment.subscription.currentPeriodStart)} 〜{' '}
              {formatDate(payment.subscription.currentPeriodEnd)}
            </p>
          )}
          {payment.receiptUrl && (
            <p>
              <a
                href={payment.receiptUrl}
                target="_blank"
                rel="noreferrer"
                className="text-brand-600 hover:underline"
              >
                Stripe 発行のレシートを表示 →
              </a>
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">お申込み内容</h2>
        </CardHeader>
        <CardBody className="p-0">
          <div className="flex items-center justify-between px-4 py-3 sm:px-6">
            <div>
              <p className="text-sm font-medium text-slate-800">{planLabel} プラン</p>
              <p className="text-xs text-slate-500">{intervalLabel}課金</p>
            </div>
            <p className="text-sm font-semibold text-slate-800">{formatJpy(payment.amount)}</p>
          </div>
          <div className="space-y-1 border-t border-slate-100 px-4 py-4 text-sm sm:px-6">
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
              <span>合計</span>
              <span>{formatJpy(payment.amount)}</span>
            </div>
          </div>
        </CardBody>
      </Card>

      <p className="text-xs text-slate-400">
        プランの変更・解約は{' '}
        <Link href="/me" className="text-brand-600 hover:underline">
          マイページ
        </Link>{' '}
        から行えます。
      </p>
    </div>
  );
}
