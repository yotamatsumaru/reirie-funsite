import type { Metadata } from 'next';
import { requireSuperAdmin } from '@/auth';
import { prisma } from '@idol/db';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { getPointRates } from '@/lib/app-setting';
import { RatesForm } from './rates-form';

export const metadata: Metadata = { title: 'ポイント設定 | Super Admin' };
export const dynamic = 'force-dynamic';

export default async function SuperAdminPointsPage() {
  await requireSuperAdmin();

  const [rates, totalPoints, txCount] = await Promise.all([
    getPointRates(),
    prisma.user.aggregate({ _sum: { points: true } }),
    prisma.pointTransaction.count(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">ポイント設定</h1>
        <p className="mt-1 text-sm text-slate-600">
          会員カードのポイント付与レートを設定します。変更は即時反映され、本番でも永続化されます。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">発行済みポイント総数</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {(totalPoints._sum.points ?? 0).toLocaleString()}
              <span className="ml-1 text-sm font-normal text-slate-500">pt</span>
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-slate-500">ポイント取引件数</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">
              {txCount.toLocaleString()}
              <span className="ml-1 text-sm font-normal text-slate-500">件</span>
            </p>
          </CardBody>
        </Card>
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
