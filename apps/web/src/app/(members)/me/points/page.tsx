import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export const metadata: Metadata = { title: 'ポイント履歴' };
export const dynamic = 'force-dynamic';

const REASON_LABELS: Record<string, string> = {
  LOGIN_BONUS: 'ログインボーナス',
  LOGIN_STREAK: '連続ログインボーナス',
  SOCIAL_SHARE: 'SNSシェア',
  ADMIN_ADJUST: '運営による調整',
  SIGNUP_BONUS: '新規登録ボーナス',
  OTHER: 'その他',
};

export default async function PointsHistoryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/me/points');

  const [user, transactions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { points: true },
    }),
    prisma.pointTransaction.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  ]);

  const balance = user?.points ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">ポイント履歴</h1>
          <p className="mt-1 text-sm text-slate-500">直近 100 件の取引</p>
        </div>
        <Link href="/me/card" className="text-sm text-brand-600 hover:underline">
          会員カードへ戻る
        </Link>
      </header>

      <Card>
        <CardBody className="flex items-center justify-between">
          <p className="text-sm text-slate-500">現在の保有ポイント</p>
          <p className="text-3xl font-bold text-slate-900">
            {balance.toLocaleString()}
            <span className="ml-1 text-base font-normal text-slate-500">pt</span>
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">取引履歴</h2>
        </CardHeader>
        <CardBody className="p-0">
          {transactions.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">
              まだポイント履歴はありません。会員カードからログインボーナスやSNSシェアでポイントを貯めましょう。
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {transactions.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-800">
                        {REASON_LABELS[t.reason] ?? t.reason}
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
    </div>
  );
}
