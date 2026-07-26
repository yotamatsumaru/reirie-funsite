import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@idol/db';
import {
  PLAN_LABELS,
  MAX_VIDEO_QUALITY,
  FREE_SHIPPING_THRESHOLD_BY_PLAN,
  PLAN_PUI_MULTIPLIER,
  canUseShop,
  formatJstDate,
  formatJstDateTime,
  type PlanTypeLiteral,
} from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { formatJpy } from '@/lib/pricing';
import { getUnifiedOrderHistory } from '@/lib/order-history';
import { ManageSubscriptionButtons } from '@/components/auth/ManageSubscriptionButtons';
import { WithdrawSection } from './withdraw-section';
import { SubscribedRefresh } from './subscribed-refresh';
import { ProfileSection } from './profile-section';
import { BirthdayMailSection } from './birthday-mail-section';
import { listUserBirthdayMails } from '@/lib/birthday-mail';

export const metadata: Metadata = { title: 'マイページ' };
export const dynamic = 'force-dynamic';

export default async function MePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/me');

  const [user, recentHistory, birthdayMails] = await Promise.all([
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
    // EC 注文 (グッズ) とサブスク課金を統合した「最近の注文」表示用の履歴。
    // 全件取得後にマージ済みなので、ここでは先頭 5 件だけ使う。
    getUnifiedOrderHistory(session.user.id, 5),
    // 運営から届いた誕生日メール (新しい年順)。
    listUserBirthdayMails(session.user.id),
  ]);
  const orders = recentHistory.slice(0, 5);

  const sub = user?.subscriptions[0];
  // プランは JWT (session.user.plan) ではなく、DB のアクティブなサブスクから直接導出する。
  // JWT は最大5分キャッシュされるため、加入直後は反映ラグで「無料」と表示されてしまう。
  // DB を正とすることで、加入直後でも正しいプランを即時表示する。
  const plan = (sub?.planType as PlanTypeLiteral) ?? 'FREE';
  const memberPoints = user?.pui ?? 0;
  const maxQuality = MAX_VIDEO_QUALITY[plan];

  // 登録情報 (お届け先) セクション用。birthDate は <input type="date"> と
  // 揃えるため YYYY-MM-DD の文字列に正規化する。
  const profileInfo = {
    fullName: user?.fullName ?? null,
    furigana: user?.furigana ?? null,
    phone: user?.phone ?? null,
    birthDate: user?.birthDate
      ? new Date(user.birthDate).toISOString().slice(0, 10)
      : null,
    postalCode: user?.postalCode ?? null,
    prefecture: user?.prefecture ?? null,
    addressLine1: user?.addressLine1 ?? null,
    addressLine2: user?.addressLine2 ?? null,
  };
  const freeShippingThreshold = FREE_SHIPPING_THRESHOLD_BY_PLAN[plan];
  // 無料会員は物販 (EC) を利用できないため、送料特典ではなく「利用不可」を表示する。
  const canShop = canUseShop(plan);
  const puiMultiplier = PLAN_PUI_MULTIPLIER[plan];

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      {/* 加入直後 (?subscribed=1) に JWT のプランを強制リフレッシュ */}
      <Suspense fallback={null}>
        <SubscribedRefresh />
      </Suspense>
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
              次回更新日: {formatJstDate(sub.currentPeriodEnd)}
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

      {/* 会員カード & Pui */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">会員カード・Pui</h2>
            <Link href="/me/card" className="text-sm text-brand-600 hover:underline">
              会員カードを表示 →
            </Link>
          </div>
        </CardHeader>
        <CardBody className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs text-slate-500">保有 Pui</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">
              {memberPoints.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              ログイン・SNSシェア・ミニゲームで貯まり、購入も可能です
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/me/card"
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Pui を貯める
            </Link>
            <Link
              href="/me/points"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              履歴
            </Link>
          </div>
        </CardBody>
      </Card>

      {/* 運営から届いた誕生日メール (ある場合のみ表示) */}
      {birthdayMails.length > 0 && (
        <BirthdayMailSection
          mails={birthdayMails.map((m) => ({
            id: m.id,
            year: m.year,
            subject: m.subject,
            body: m.body,
            imageUrl: m.imageUrl,
            sentAt: m.sentAt.toISOString(),
            readAt: m.readAt ? m.readAt.toISOString() : null,
          }))}
        />
      )}

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
          {/* 物販 (ショップ) / 送料 */}
          {canShop ? (
            // スタンダード以上: 送料特典を表示
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
          ) : (
            // 無料会員: 物販は利用できないため、その旨を表示 (送料は表示しない)
            <div className="rounded-lg border border-slate-200 p-4">
              <p className="text-xs text-slate-500">物販（ショップ）</p>
              <p className="mt-1 text-xl font-bold text-slate-400">ご利用不可</p>
              <p className="mt-1 text-xs text-slate-500">スタンダード以上でお買い物可能</p>
            </div>
          )}
          {/* Pui 付与率 (全プラン共通で持つ特典) */}
          <div className="rounded-lg border border-slate-200 p-4">
            <p className="text-xs text-slate-500">Pui 付与率</p>
            <p className="mt-1 text-xl font-bold text-slate-900">
              ×{puiMultiplier.toFixed(1)}
            </p>
            {plan !== 'PREMIUM' && (
              <p className="mt-1 text-xs text-slate-500">
                プレミアムで ×{PLAN_PUI_MULTIPLIER.PREMIUM.toFixed(1)} に
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
              {orders.map((entry) => {
                const href =
                  entry.type === 'ORDER'
                    ? `/me/orders/${entry.id}`
                    : `/me/orders/subscription/${entry.id}`;
                const label =
                  entry.type === 'ORDER'
                    ? entry.documentNumber
                    : entry.planLabel
                      ? `${entry.planLabel} プラン${entry.intervalLabel ? ` (${entry.intervalLabel})` : ''}`
                      : 'サブスクリプション';
                const isSuccess =
                  entry.type === 'ORDER' ? entry.status === 'PAID' : entry.status === 'SUCCEEDED';
                return (
                  <li key={`${entry.type}-${entry.id}`}>
                    <Link
                      href={href}
                      className="flex items-center justify-between py-3 hover:bg-slate-50"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge tone={entry.type === 'ORDER' ? 'brand' : 'info'}>
                            {entry.type === 'ORDER' ? 'EC注文' : 'サブスク'}
                          </Badge>
                          <p className="text-sm text-slate-700">{label}</p>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {formatJstDateTime(entry.createdAt)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-slate-800">
                          {formatJpy(entry.amount)}
                        </p>
                        <Badge tone={isSuccess ? 'success' : 'gray'}>{entry.status}</Badge>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* 登録情報 (お届け先) — グッズ発送に必要な情報の表示・編集 */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">登録情報（お届け先）</h2>
        </CardHeader>
        <CardBody>
          <ProfileSection initial={profileInfo} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">クイックリンク</h2>
        </CardHeader>
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Link href="/me/card" className="rounded-md border border-slate-200 px-4 py-3 hover:border-brand-500">
            会員カード・Pui
          </Link>
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

      <div className="pt-2 text-center">
        <WithdrawSection hasActiveSub={Boolean(sub)} />
      </div>
    </div>
  );
}
