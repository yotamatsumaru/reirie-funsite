import type { Metadata } from 'next';
import Link from 'next/link';
import { Wallet, ListChecks } from 'lucide-react';
import { requireSuperAdmin } from '@/auth';
import { prisma } from '@idol/db';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { getPuiRates } from '@/lib/app-setting';
import { findPuiAnomalies } from '@/lib/points';
import { RatesForm } from './rates-form';

export const metadata: Metadata = { title: 'Pui 設定 | Super Admin' };
export const dynamic = 'force-dynamic';

export default async function SuperAdminPointsPage() {
  await requireSuperAdmin();

  const [rates, totalPoints, txCount, anomalies] = await Promise.all([
    getPuiRates(),
    prisma.user.aggregate({ _sum: { pui: true } }),
    prisma.puiTransaction.count(),
    findPuiAnomalies(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Pui 設定</h1>
        <p className="mt-1 text-sm text-slate-600">
          会員カードの Pui 付与レートを設定します。変更は即時反映され、本番でも永続化されます。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">発行済み Pui 総数</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {(totalPoints._sum.pui ?? 0).toLocaleString()}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">Pui 取引件数</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {txCount.toLocaleString()}
              <span className="ml-1 text-sm font-normal text-slate-500">件</span>
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">整合性チェック</p>
            <div className="mt-2 flex items-center gap-2">
              {anomalies.length === 0 ? (
                <>
                  <span className="text-2xl font-bold text-emerald-600">正常</span>
                  <Badge tone="success">異常なし</Badge>
                </>
              ) : (
                <>
                  <span className="text-2xl font-bold text-rose-600">{anomalies.length}</span>
                  <Badge tone="danger">件の不整合</Badge>
                </>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* 監視ページへのリンク */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/super-admin/points/users"
          className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50"
        >
          <Wallet className="h-5 w-5 text-brand-500" aria-hidden />
          全ユーザーの Pui 状況を見る
        </Link>
        <Link
          href="/super-admin/points/transactions"
          className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50"
        >
          <ListChecks className="h-5 w-5 text-brand-500" aria-hidden />
          Pui 取引ログ・異常検知を見る
        </Link>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">付与レート</h2>
        </CardHeader>
        <CardBody>
          <RatesForm initial={rates} />
        </CardBody>
      </Card>
    </div>
  );
}
