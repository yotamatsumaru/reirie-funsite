/**
 * /me/rewards/buy — Pui パック購入 (Stripe Checkout)
 *
 * 【2026-07 統合】以前は特典ポイント (旧 User.rewardPoints) を付与していたが、
 * Pui 1 種類への統合に伴い、User.pui を付与する。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { Card, CardBody } from '@/components/ui/Card';
import { BuyPointsClient } from './buy-points-client';

export const metadata: Metadata = { title: 'Pui を購入' };
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
      select: { pui: true },
    }),
    prisma.rewardPointPack.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { priceJpy: 'asc' }],
      select: { id: true, name: true, pui: true, priceJpy: true },
    }),
  ]);

  const balance = user?.pui ?? 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Pui を購入</h1>
          <p className="mt-1 text-sm text-slate-500">
            クレジットカード決済 (Stripe) で Pui を購入できます。購入した Pui は景品カタログとの交換や、ゲーム内購入にも使えます。
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
          <p className="text-sm text-slate-500">保有 Pui</p>
          <p className="text-3xl font-bold text-slate-900">
            {balance.toLocaleString()}
          </p>
        </CardBody>
      </Card>

      <BuyPointsClient packs={packs} />
    </div>
  );
}
