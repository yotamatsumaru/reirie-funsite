/**
 * GET /api/me/reward-downloads
 *  - ログイン会員が「交換済み」のデジタル特典 (DIGITAL) と、
 *    その配布ファイル一覧を返す。
 *  - 交換 (RewardRedemption) が CANCELED のものは除外する。
 *  - ファイル本体は返さず、ダウンロード用の情報 (id, fileName など) のみ返す。
 *    実体は GET /api/me/reward-downloads/[assetId] で本人確認のうえ配信する。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireApiSession } from '@/lib/api-auth';
import { handle } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  const session = await requireApiSession(req);

  // 本人が交換した DIGITAL の景品 (キャンセル以外) を対象にする
  const redemptions = await prisma.rewardRedemption.findMany({
    where: {
      userId: session.user.id,
      itemKind: 'DIGITAL',
      status: { not: 'CANCELED' },
    },
    orderBy: { createdAt: 'desc' },
    select: { catalogItemId: true, itemName: true, createdAt: true },
  });

  if (redemptions.length === 0) {
    return NextResponse.json({ items: [] });
  }

  // 交換済み景品ごとに最初の交換日をまとめる (重複交換にも対応)
  const firstRedeemedAt = new Map<string, Date>();
  const nameById = new Map<string, string>();
  for (const r of redemptions) {
    nameById.set(r.catalogItemId, r.itemName);
    const prev = firstRedeemedAt.get(r.catalogItemId);
    if (!prev || r.createdAt < prev) firstRedeemedAt.set(r.catalogItemId, r.createdAt);
  }

  const catalogItemIds = [...firstRedeemedAt.keys()];
  const assets = await prisma.rewardDigitalAsset.findMany({
    where: { catalogItemId: { in: catalogItemIds } },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      catalogItemId: true,
      fileName: true,
      contentType: true,
      fileSize: true,
    },
  });

  // 景品単位でグルーピング
  const grouped = catalogItemIds.map((id) => ({
    catalogItemId: id,
    itemName: nameById.get(id) ?? '',
    redeemedAt: firstRedeemedAt.get(id)?.toISOString() ?? null,
    files: assets
      .filter((a) => a.catalogItemId === id)
      .map((a) => ({
        id: a.id,
        fileName: a.fileName,
        contentType: a.contentType,
        fileSize: a.fileSize,
      })),
  }));

  // ファイルの有無に関わらず、交換済みの景品はすべて返す
  return NextResponse.json({ items: grouped });
});
