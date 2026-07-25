/**
 * /super-admin/rewards — 景品交換・Fan ポイントパック統計
 *
 * SUPER_ADMIN 限定。
 * 2026-07 のポイント統合により、ユーザーの Fan ポイント残高の手動調整は
 * /super-admin/points/users に統合された (このページには調整 UI を持たない)。
 * ここでは景品カタログ/パック/交換件数の統計と、各管理画面への入口のみを表示する。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Package, Truck, Wallet } from 'lucide-react';
import { requireSuperAdminView } from '@/auth';
import { prisma } from '@idol/db';
import { Card, CardBody } from '@/components/ui/Card';

export const metadata: Metadata = { title: '景品交換・ポイントパック統計 | Super Admin' };
export const dynamic = 'force-dynamic';

export default async function SuperAdminRewardsPage() {
  await requireSuperAdminView();

  const [catalogCount, packCount, redemptionCount] = await Promise.all([
    prisma.rewardCatalogItem.count(),
    prisma.rewardPointPack.count(),
    prisma.rewardRedemption.count(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">景品交換・Fan ポイントパック統計</h1>
        <p className="mt-1 text-sm text-slate-600">
          景品カタログ・Fan ポイントパックの登録件数と景品交換件数を確認できます。
          ユーザーの Fan ポイント残高の確認・手動調整は「ポイント状況」ページで行います。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">景品カタログ登録件数</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {catalogCount.toLocaleString()}
              <span className="ml-1 text-sm font-normal text-slate-500">件</span>
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">Fan ポイントパック登録件数</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {packCount.toLocaleString()}
              <span className="ml-1 text-sm font-normal text-slate-500">件</span>
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">景品交換件数</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {redemptionCount.toLocaleString()}
              <span className="ml-1 text-sm font-normal text-slate-500">件</span>
            </p>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Link
          href="/super-admin/points/users"
          className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50"
        >
          <Wallet className="h-5 w-5 text-brand-500" aria-hidden />
          Fan ポイント残高・手動調整
        </Link>
        <Link
          href="/super-admin/rewards/packs"
          className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50"
        >
          <Package className="h-5 w-5 text-brand-500" aria-hidden />
          Fan ポイントパック管理 ({packCount} 件)
        </Link>
        <Link
          href="/admin/rewards/catalog"
          className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50"
        >
          <Truck className="h-5 w-5 text-brand-500" aria-hidden />
          景品カタログ・発送管理 ({catalogCount} 件)
        </Link>
      </div>
    </div>
  );
}
