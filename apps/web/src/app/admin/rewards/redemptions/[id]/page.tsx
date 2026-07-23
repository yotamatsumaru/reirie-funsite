import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@idol/db';
import {
  REWARD_CATALOG_ITEM_KIND_LABELS,
  REWARD_REDEMPTION_STATUS_LABELS,
  requiresShipping,
  type RewardCatalogItemKindLiteral,
  type RewardRedemptionStatusLiteral,
} from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { requireCapabilityPage } from '@/auth';
import { StatusForm } from './status-form';

export const dynamic = 'force-dynamic';

export default async function RedemptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCapabilityPage('MERCH');
  const { id } = await params;
  const redemption = await prisma.rewardRedemption.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
          memberNumber: true,
          phone: true,
          postalCode: true,
          prefecture: true,
          addressLine1: true,
          addressLine2: true,
        },
      },
      catalogItem: { select: { id: true, slug: true, name: true, kind: true } },
    },
  });
  if (!redemption) notFound();

  const needsShipping = requiresShipping(redemption.itemKind as RewardCatalogItemKindLiteral);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/rewards/redemptions" className="text-xs text-slate-500 hover:underline">
          ← 発送管理一覧
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">{redemption.itemName}</h1>
          <Badge tone="info">{REWARD_CATALOG_ITEM_KIND_LABELS[redemption.itemKind]}</Badge>
          <Badge tone="gray">
            {REWARD_REDEMPTION_STATUS_LABELS[redemption.status as RewardRedemptionStatusLiteral]}
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">交換情報</h2>
        </CardHeader>
        <CardBody className="space-y-2 text-sm">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <p>
              <span className="text-slate-500">会員: </span>
              {redemption.user?.displayName ?? redemption.user?.email}
              <span className="ml-1 text-xs text-slate-400">
                ({redemption.user?.memberNumber ?? '-'})
              </span>
            </p>
            <p>
              <span className="text-slate-500">メール: </span>
              {redemption.user?.email}
            </p>
            <p>
              <span className="text-slate-500">消費 Pui: </span>
              {redemption.puiCost.toLocaleString()} Pui
            </p>
            <p>
              <span className="text-slate-500">申請日時: </span>
              {new Date(redemption.createdAt).toLocaleString('ja-JP')}
            </p>
            {redemption.shippedAt && (
              <p>
                <span className="text-slate-500">発送日時: </span>
                {new Date(redemption.shippedAt).toLocaleString('ja-JP')}
              </p>
            )}
            {redemption.completedAt && (
              <p>
                <span className="text-slate-500">完了日時: </span>
                {new Date(redemption.completedAt).toLocaleString('ja-JP')}
              </p>
            )}
            {redemption.canceledAt && (
              <p>
                <span className="text-slate-500">キャンセル日時: </span>
                {new Date(redemption.canceledAt).toLocaleString('ja-JP')}
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      {needsShipping && (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-900">発送先 (申請時スナップショット)</h2>
          </CardHeader>
          <CardBody className="space-y-1 text-sm text-slate-700">
            <p>{redemption.shippingName ?? '(未入力)'}</p>
            <p>{redemption.shippingPhone ?? ''}</p>
            <p>
              〒{redemption.shippingPostalCode ?? ''} {redemption.shippingPrefecture ?? ''}
            </p>
            <p>{redemption.shippingAddress1 ?? ''}</p>
            <p>{redemption.shippingAddress2 ?? ''}</p>
            {redemption.trackingNumber && (
              <p className="mt-2 text-xs text-slate-500">
                追跡番号: <span className="font-mono">{redemption.trackingNumber}</span>
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {redemption.adminNote && (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-900">運営メモ</h2>
          </CardHeader>
          <CardBody className="whitespace-pre-wrap text-sm text-slate-700">
            {redemption.adminNote}
          </CardBody>
        </Card>
      )}

      <StatusForm
        id={redemption.id}
        currentStatus={redemption.status as RewardRedemptionStatusLiteral}
        currentTrackingNumber={redemption.trackingNumber}
        currentAdminNote={redemption.adminNote}
      />
    </div>
  );
}
