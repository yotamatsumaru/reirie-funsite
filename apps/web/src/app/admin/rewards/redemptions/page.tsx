/**
 * /admin/rewards/redemptions — 景品交換・発送管理 一覧
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import {
  REWARD_REDEMPTION_STATUSES,
  REWARD_REDEMPTION_STATUS_LABELS,
  REWARD_CATALOG_ITEM_KIND_LABELS,
  type RewardRedemptionStatusLiteral, formatJstDateTime} from '@idol/shared';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { requireCapabilityPage } from '@/auth';

export const metadata: Metadata = { title: '発送管理' };
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<RewardRedemptionStatusLiteral, 'gray' | 'info' | 'success' | 'danger' | 'warning'> = {
  PENDING: 'warning',
  PROCESSING: 'info',
  SHIPPED: 'success',
  COMPLETED: 'gray',
  CANCELED: 'danger',
};

export default async function AdminRedemptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireCapabilityPage('MERCH');
  const { status } = await searchParams;
  const validStatus = (REWARD_REDEMPTION_STATUSES as readonly string[]).includes(status ?? '')
    ? (status as RewardRedemptionStatusLiteral)
    : undefined;

  const redemptions = await prisma.rewardRedemption.findMany({
    where: validStatus ? { status: validStatus } : {},
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      user: { select: { email: true, displayName: true, memberNumber: true } },
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">発送管理</h1>
          <p className="mt-1 text-sm text-slate-500">
            景品交換の受付〜発送〜完了までを管理します。
          </p>
        </div>
        <Link
          href="/admin/rewards/catalog"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          景品カタログへ
        </Link>
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs">
        <Link
          href="/admin/rewards/redemptions"
          className={`rounded-full border px-3 py-1.5 ${
            !validStatus
              ? 'border-brand-400 bg-brand-50 text-brand-700'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          すべて
        </Link>
        {REWARD_REDEMPTION_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/rewards/redemptions?status=${s}`}
            className={`rounded-full border px-3 py-1.5 ${
              validStatus === s
                ? 'border-brand-400 bg-brand-50 text-brand-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {REWARD_REDEMPTION_STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      <div className="space-y-3 md:hidden">
        {redemptions.length === 0 && (
          <Card>
            <CardBody className="text-center text-sm text-slate-500">交換申請はありません</CardBody>
          </Card>
        )}
        {redemptions.map((r) => (
          <Card key={r.id}>
            <CardBody className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={`/admin/rewards/redemptions/${r.id}`}
                  className="font-semibold text-brand-600 hover:underline"
                >
                  {r.itemName}
                </Link>
                <Badge tone={STATUS_TONE[r.status as RewardRedemptionStatusLiteral]}>
                  {REWARD_REDEMPTION_STATUS_LABELS[r.status]}
                </Badge>
              </div>
              <p className="text-xs text-slate-500">
                {r.user?.displayName ?? r.user?.email} ({r.user?.memberNumber ?? '-'})
              </p>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{REWARD_CATALOG_ITEM_KIND_LABELS[r.itemKind]}</span>
                <span>{formatJstDateTime(r.createdAt)}</span>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card className="hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">景品</th>
              <th className="px-4 py-2">会員</th>
              <th className="px-4 py-2">種別</th>
              <th className="px-4 py-2 text-right">消費 Pui</th>
              <th className="px-4 py-2">状態</th>
              <th className="px-4 py-2">申請日時</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {redemptions.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  交換申請はありません
                </td>
              </tr>
            )}
            {redemptions.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-slate-800">{r.itemName}</td>
                <td className="px-4 py-2 text-slate-600">
                  {r.user?.displayName ?? r.user?.email}
                  <span className="ml-1 text-xs text-slate-400">({r.user?.memberNumber ?? '-'})</span>
                </td>
                <td className="px-4 py-2">{REWARD_CATALOG_ITEM_KIND_LABELS[r.itemKind]}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.puiCost.toLocaleString()}</td>
                <td className="px-4 py-2">
                  <Badge tone={STATUS_TONE[r.status as RewardRedemptionStatusLiteral]}>
                    {REWARD_REDEMPTION_STATUS_LABELS[r.status]}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">
                  {formatJstDateTime(r.createdAt)}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    href={`/admin/rewards/redemptions/${r.id}`}
                    className="text-brand-600 hover:underline"
                  >
                    詳細
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
