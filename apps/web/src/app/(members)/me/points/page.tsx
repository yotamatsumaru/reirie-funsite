import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@idol/db';
import {
  REWARD_POINT_REASON_LABELS,
  REWARD_REDEMPTION_STATUS_LABELS,
  type RewardRedemptionStatusLiteral,
} from '@idol/shared';
import { auth } from '@/auth';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export const metadata: Metadata = { title: 'ポイント履歴' };
export const dynamic = 'force-dynamic';

const FAN_REASON_LABELS: Record<string, string> = {
  LOGIN_BONUS: 'ログインボーナス',
  LOGIN_STREAK: '連続ログインボーナス',
  SOCIAL_SHARE: 'SNSシェア',
  ADMIN_ADJUST: '運営による調整',
  SIGNUP_BONUS: '新規登録ボーナス',
  GAME_REWARD: 'ミニゲーム勝利報酬',
  ITEM_PURCHASE: '恋愛ADV購入 (Fanポイント)',
  EXTRA_PLAY_PURCHASE: 'ミニゲーム追加プレイ購入',
  OTHER: 'その他',
};

const REDEMPTION_STATUS_TONE: Record<
  RewardRedemptionStatusLiteral,
  'gray' | 'info' | 'success' | 'danger' | 'warning'
> = {
  PENDING: 'warning',
  PROCESSING: 'info',
  SHIPPED: 'success',
  COMPLETED: 'gray',
  CANCELED: 'danger',
};

export default async function PointsHistoryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/me/points');

  const [user, fanTransactions, rewardTransactions, redemptions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { points: true, rewardPoints: true },
    }),
    prisma.pointTransaction.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.rewardPointTransaction.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.rewardRedemption.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
  ]);

  const fanBalance = user?.points ?? 0;
  const rewardBalance = user?.rewardPoints ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">ポイント履歴</h1>
          <p className="mt-1 text-sm text-slate-500">Fan ポイント・特典ポイントの残高と履歴</p>
        </div>
        <Link href="/me/card" className="text-sm text-brand-600 hover:underline">
          会員カードへ戻る
        </Link>
      </header>

      {/* 残高サマリー */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardBody>
            <p className="text-sm text-slate-500">Fan ポイント</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">
              {fanBalance.toLocaleString()}
              <span className="ml-1 text-base font-normal text-slate-500">pt</span>
            </p>
            <p className="mt-2 text-xs text-slate-500">
              ログイン・SNSシェア・ミニゲームで貯まり、恋愛ADVの購入やミニゲームの追加プレイに使えます。
            </p>
            <Link href="/game" className="mt-2 inline-block text-xs text-brand-600 hover:underline">
              ゲームで使う →
            </Link>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-sm text-slate-500">特典ポイント</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">
              {rewardBalance.toLocaleString()}
              <span className="ml-1 text-base font-normal text-slate-500">pt</span>
            </p>
            <p className="mt-2 text-xs text-slate-500">
              購入 or サブスク月次特典で貯まり、景品カタログとの交換に使えます。
            </p>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              <Link href="/me/rewards/buy" className="inline-block text-xs text-brand-600 hover:underline">
                ポイントを購入する →
              </Link>
              <Link href="/me/rewards" className="inline-block text-xs text-brand-600 hover:underline">
                景品と交換する →
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Fan ポイント履歴 */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Fan ポイント 取引履歴</h2>
        </CardHeader>
        <CardBody className="p-0">
          {fanTransactions.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">
              まだ Fan ポイント履歴はありません。会員カードからログインボーナスやSNSシェアでポイントを貯めましょう。
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {fanTransactions.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-800">
                        {FAN_REASON_LABELS[t.reason] ?? t.reason}
                      </p>
                      {t.amount > 0 ? (
                        <Badge tone="success">獲得</Badge>
                      ) : (
                        <Badge tone="gray">利用</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {new Date(t.createdAt).toLocaleString('ja-JP')}
                      {t.note ? ` ・ ${t.note}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-bold ${
                        t.amount > 0 ? 'text-emerald-600' : 'text-slate-600'
                      }`}
                    >
                      {t.amount > 0 ? '+' : ''}
                      {t.amount.toLocaleString()}pt
                    </p>
                    <p className="text-xs text-slate-400">残高 {t.balance.toLocaleString()}pt</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* 特典ポイント履歴 */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">特典ポイント 取引履歴</h2>
        </CardHeader>
        <CardBody className="p-0">
          {rewardTransactions.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">
              まだ特典ポイント履歴はありません。ポイントパックの購入やサブスクの月次特典で貯まります。
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rewardTransactions.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-800">
                        {REWARD_POINT_REASON_LABELS[t.reason as keyof typeof REWARD_POINT_REASON_LABELS] ??
                          t.reason}
                      </p>
                      {t.amount > 0 ? (
                        <Badge tone="success">獲得</Badge>
                      ) : (
                        <Badge tone="gray">利用</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {new Date(t.createdAt).toLocaleString('ja-JP')}
                      {t.note ? ` ・ ${t.note}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-bold ${
                        t.amount > 0 ? 'text-emerald-600' : 'text-slate-600'
                      }`}
                    >
                      {t.amount > 0 ? '+' : ''}
                      {t.amount.toLocaleString()}pt
                    </p>
                    <p className="text-xs text-slate-400">残高 {t.balance.toLocaleString()}pt</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* 景品交換履歴 */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">景品交換履歴</h2>
        </CardHeader>
        <CardBody className="p-0">
          {redemptions.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">
              まだ景品交換はありません。
              <Link href="/me/rewards" className="ml-1 text-brand-600 hover:underline">
                景品カタログを見る →
              </Link>
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {redemptions.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{r.itemName}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {new Date(r.createdAt).toLocaleString('ja-JP')}
                      {r.trackingNumber ? ` ・ 追跡番号: ${r.trackingNumber}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge tone={REDEMPTION_STATUS_TONE[r.status as RewardRedemptionStatusLiteral]}>
                      {REWARD_REDEMPTION_STATUS_LABELS[r.status as RewardRedemptionStatusLiteral]}
                    </Badge>
                    <p className="mt-1 text-xs text-slate-400">
                      -{r.pointCost.toLocaleString()}pt
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
