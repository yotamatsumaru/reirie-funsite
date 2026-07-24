/**
 * デジタル特典ダウンロード数の集計ヘルパー。
 *  - 景品 (catalogItemId) 単位で「延べ回数 (total)」と
 *    「ユニーク人数 (unique / distinct userId)」を算出する。
 */
import { prisma } from '@idol/db';

export type DownloadStat = { total: number; unique: number };

/**
 * 複数の景品 ID についてまとめてダウンロード数を集計する。
 * 戻り値は catalogItemId → { total, unique } の Map。
 * 対象が無い / ログが無い ID は Map に含まれない (呼び出し側で 0 埋め)。
 */
export async function getDownloadStatsByCatalogItem(
  catalogItemIds: string[],
): Promise<Map<string, DownloadStat>> {
  const result = new Map<string, DownloadStat>();
  if (catalogItemIds.length === 0) return result;

  // 延べ回数: catalogItemId ごとの件数
  const totals = await prisma.rewardDownloadLog.groupBy({
    by: ['catalogItemId'],
    where: { catalogItemId: { in: catalogItemIds } },
    _count: { _all: true },
  });
  for (const t of totals) {
    result.set(t.catalogItemId, { total: t._count._all, unique: 0 });
  }

  // ユニーク人数: (catalogItemId, userId) の distinct 件数を
  // catalogItemId 単位で数える。groupBy で重複ペアを潰してから集計する。
  const pairs = await prisma.rewardDownloadLog.groupBy({
    by: ['catalogItemId', 'userId'],
    where: { catalogItemId: { in: catalogItemIds } },
  });
  const uniqueCount = new Map<string, number>();
  for (const p of pairs) {
    uniqueCount.set(p.catalogItemId, (uniqueCount.get(p.catalogItemId) ?? 0) + 1);
  }
  for (const [id, unique] of uniqueCount) {
    const cur = result.get(id) ?? { total: 0, unique: 0 };
    cur.unique = unique;
    result.set(id, cur);
  }

  return result;
}

/** 単一景品のダウンロード数を集計する。 */
export async function getDownloadStat(catalogItemId: string): Promise<DownloadStat> {
  const map = await getDownloadStatsByCatalogItem([catalogItemId]);
  return map.get(catalogItemId) ?? { total: 0, unique: 0 };
}
