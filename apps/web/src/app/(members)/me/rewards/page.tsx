/**
 * /me/rewards — 景品カタログ (Pui 交換)
 *
 * 【2026-07 統合】以前は特典ポイント (旧 User.rewardPoints) を消費していたが、
 * Pui 1 種類への統合に伴い、User.pui を消費する。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { Card, CardBody } from '@/components/ui/Card';
import { RewardsSection } from './rewards-section';

export const metadata: Metadata = { title: '景品交換' };
export const dynamic = 'force-dynamic';

export default async function MeRewardsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin?callbackUrl=/me/rewards');

  // カタログ取得はテーブル未整備 (マイグレーション未適用) 等で失敗しうる。
  // その場合でもページ全体をクラッシュ (真っ黒画面) させず、
  // 「交換できる景品はありません」表示にフォールバックする。
  const [user, items] = await Promise.all([
    prisma.user
      .findUnique({
        where: { id: session.user.id },
        select: {
          pui: true,
          fullName: true,
          phone: true,
          postalCode: true,
          prefecture: true,
          addressLine1: true,
          addressLine2: true,
        },
      })
      .catch((e) => {
        console.error('[me/rewards] failed to load user', e);
        return null;
      }),
    prisma.rewardCatalogItem
      .findMany({
        where: { status: 'PUBLISHED' },
        orderBy: [{ sortOrder: 'asc' }, { puiCost: 'asc' }],
        select: {
          id: true,
          slug: true,
          kind: true,
          name: true,
          description: true,
          imageUrl: true,
          puiCost: true,
          stock: true,
        },
      })
      .catch((e) => {
        console.error('[me/rewards] failed to load catalog', e);
        return [] as Awaited<ReturnType<typeof prisma.rewardCatalogItem.findMany>>;
      }),
  ]);

  const balance = user?.pui ?? 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">景品交換</h1>
          <p className="mt-1 text-sm text-slate-500">
            Pui でグッズ・特典会優先枠・デジタル特典と交換できます。
          </p>
        </div>
        <Link href="/me/points" className="text-sm text-brand-600 hover:underline">
          ポイント履歴へ
        </Link>
      </header>

      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">保有 Pui</p>
            <p className="text-3xl font-bold text-slate-900">
              {balance.toLocaleString()}
            </p>
          </div>
          <Link
            href="/me/rewards/buy"
            className="inline-flex items-center rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            + Pui を購入する
          </Link>
        </CardBody>
      </Card>

      <RewardsSection
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
