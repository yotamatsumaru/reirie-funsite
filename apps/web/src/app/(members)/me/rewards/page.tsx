/**
 * /me/rewards — 景品カタログ (特典ポイント交換)
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { Card, CardBody } from '@/components/ui/Card';
import { RewardsClient } from './rewards-client';

export const metadata: Metadata = { title: '景品交換' };
export const dynamic = 'force-dynamic';

export default async function MeRewardsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/me/rewards');

  const [user, items] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        rewardPoints: true,
        fullName: true,
        phone: true,
        postalCode: true,
        prefecture: true,
        addressLine1: true,
        addressLine2: true,
      },
    }),
    prisma.rewardCatalogItem.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ sortOrder: 'asc' }, { pointCost: 'asc' }],
      select: {
        id: true,
        slug: true,
        kind: true,
        name: true,
        description: true,
        imageUrl: true,
        pointCost: true,
        stock: true,
      },
    }),
  ]);

  const balance = user?.rewardPoints ?? 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">景品交換</h1>
          <p className="mt-1 text-sm text-slate-500">
            特典ポイントでグッズ・特典会優先枠・デジタル特典と交換できます。
          </p>
        </div>
        <Link href="/me/points" className="text-sm text-brand-600 hover:underline">
          ポイント履歴へ
        </Link>
      </header>

      <Card>
        <CardBody className="flex items-center justify-between">
          <p className="text-sm text-slate-500">保有 特典ポイント</p>
          <p className="text-3xl font-bold text-slate-900">
            {balance.toLocaleString()}
            <span className="ml-1 text-base font-normal text-slate-500">pt</span>
          </p>
        </CardBody>
      </Card>

      <RewardsClient
        items={items}
        balance={balance}
        defaultShipping={{
          shippingName: user?.fullName ?? '',
          shippingPhone: user?.phone ?? '',
          shippingPostalCode: user?.postalCode ?? '',
          shippingPrefecture: user?.prefecture ?? '',
          shippingAddress1: user?.addressLine1 ?? '',
          shippingAddress2: user?.addressLine2 ?? '',
        }}
      />
    </div>
  );
}
