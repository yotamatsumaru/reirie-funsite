/**
 * /me/rewards/buy — 特典ポイントパック購入 (Stripe Checkout)
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { Card, CardBody } from '@/components/ui/Card';
import { BuyPointsClient } from './buy-points-client';

export const metadata: Metadata = { title: '特典ポイントを購入' };
export const dynamic = 'force-dynamic';

export default async function BuyRewardPointsPage({
  searchParams,
}: {
  searchParams: Promise<{ canceled?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/me/rewards/buy');

  const { canceled } = await searchParams;

  const [user, packs] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { rewardPoints: true },
    }),
    prisma.rewardPointPack.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { priceJpy: 'asc' }],
      select: { id: true, name: true, points: true, priceJpy: true },
    }),
  ]);

  const balance = user?.rewardPoints ?? 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">特典ポイントを購入</h1>
          <p className="mt-1 text-sm text-slate-500">
            クレジットカード決済 (Stripe) で特典ポイントを購入できます。購入したポイントは景品カタログとの交換に使えます。
          </p>
        </div>
        <Link href="/me/rewards" className="text-sm text-brand-600 hover:underline">
          景品カタログへ戻る
        </Link>
      </header>

      {canceled && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          決済がキャンセルされました。もう一度お試しください。
        </p>
      )}

      <Card>
        <CardBody className="flex items-center justify-between">
          <p className="text-sm text-slate-500">保有 特典ポイント</p>
          <p className="text-3xl font-bold text-slate-900">
            {balance.toLocaleString()}
            <span className="ml-1 text-base font-normal text-slate-500">pt</span>
          </p>
        </CardBody>
      </Card>

      <BuyPointsClient packs={packs} />
    </div>
  );
}
