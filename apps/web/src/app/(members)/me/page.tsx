import type { Metadata } from 'next';
import Link from 'next/link';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@idol/db';
import {
  PLAN_LABELS,
  SAVE_SLOT_LIMIT,
  MONTHLY_BONUS_GIFT_COUNT,
  MAX_VIDEO_QUALITY,
  FREE_SHIPPING_THRESHOLD_BY_PLAN,
  currentYearMonth,
  type PlanTypeLiteral,
} from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatJpy } from '@/lib/pricing';
import { ManageSubscriptionButtons } from '@/components/auth/ManageSubscriptionButtons';

export const metadata: Metadata = { title: 'マイページ' };
export const dynamic = 'force-dynamic';

export default async function MePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/me');

  const plan = session.user.plan as PlanTypeLiteral;
  const yearMonth = currentYearMonth();

  const [user, orders, saveSlotCount, bonusGrant] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      include: {
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    }),
    prisma.order.findMany({
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
    }),
    prisma.playerSaveSlot.count({ where: { userId: session.user.id } }),
    prisma.bonusGiftGrant.findUnique({
      where: { userId_yearMonth: { userId: session.user.id, yearMonth } },
      include: { item: { select: { name: true, iconUrl: true } } },
    }),
  ]);

  const sub = user?.subscriptions[0];
  const slotLimit = SAVE_SLOT_LIMIT[plan];
  const bonusEligible = MONTHLY_BONUS_GIFT_COUNT[plan];
  const maxQuality = MAX_VIDEO_QUALITY[plan];
  const freeShippingThreshold = FREE_SHIPPING_THRESHOLD_BY_PLAN[plan];

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">マイページ</h1>
        <p className="mt-1 text-sm text-slate-500">{user?.email}</p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">会員プラン</h2>
            <Link href="/plans" className="text-sm text-brand-600 hover:underline">
              プラン一覧を見る
            </Link>
          </div>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-3">
            <Badge tone={plan === 'PREMIUM' ? 'brand' : plan === 'STANDARD' ? 'info' : 'gray'}>
              {PLAN_LABELS[plan]}
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
          {plan === 'FREE' && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              現在は無料プランです。
              <Link href="/plans" className="ml-1 font-semibold underline">
                有料プランの特典を見る →
              </Link>
            </p>
          )}
          <ManageSubscriptionButtons hasActiveSub={Boolean(sub)} />
        </CardBody>
      </Card>

      {/* プラン特典の利用状況 */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">あなたの特典 ({PLAN_LABELS[plan]})</h2>
        </CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          {/* 動画画質 */}
          <div className="rounded-lg border border-slate-200 p-4">
            <p className="text-xs text-slate-500">動画最大画質</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{maxQuality}</p>
            {plan !== 'PREMIUM' && (
              <p className="mt-1 text-xs text-slate-500">プレミアムで 1080p に</p>
            )}
          </div>
          {/* 送料 */}
          <div className="rounded-lg border border-slate-200 p-4">
            <p className="text-xs text-slate-500">送料</p>
            <p className="mt-1 text-xl font-bold text-slate-900">
              {freeShippingThreshold === 0
                ? '常時無料'
                : `¥${freeShippingThreshold.toLocaleString()} 以上で無料`}
            </p>
            {plan !== 'PREMIUM' && (
              <p className="mt-1 text-xs text-slate-500">プレミアムで常時無料</p>
            )}
          </div>
          {/* セーブスロット */}
          <div className="rounded-lg border border-slate-200 p-4">
            <p className="text-xs text-slate-500">ゲームセーブスロット</p>
            <p className="mt-1 text-xl font-bold text-slate-900">
              {saveSlotCount} / {slotLimit} スロット
            </p>
            {plan !== 'PREMIUM' && (
              <p className="mt-1 text-xs text-slate-500">
                プレミアムで {SAVE_SLOT_LIMIT.PREMIUM} スロットに
              </p>
            )}
          </div>
          {/* 月次ボーナス */}
          <div className="rounded-lg border border-slate-200 p-4">
            <p className="text-xs text-slate-500">月次ボーナスギフト ({yearMonth})</p>
            {bonusEligible === 0 ? (
              <p className="mt-1 text-xl font-bold text-slate-400">対象外</p>
            ) : bonusGrant ? (
              <p className="mt-1 text-xl font-bold text-emerald-600">
                受取済み (×{bonusGrant.count})
              </p>
            ) : (
              <p className="mt-1 text-xl font-bold text-slate-900">
                対象 (×{bonusEligible}) / 未受取
              </p>
            )}
            {plan !== 'PREMIUM' && (
              <p className="mt-1 text-xs text-slate-500">
                プレミアムで月 {MONTHLY_BONUS_GIFT_COUNT.PREMIUM} 個に
              </p>
            )}
          </div>
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
