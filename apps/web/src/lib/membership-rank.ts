/**
 * 会員ランクのサービス層 (DB アクセス + 判定)。
 *
 * メトリクスの定義:
 *  - loginDays     : LoginBonusGrant の件数 (= ログインボーナスを受けた日数)
 *  - purchaseCount : 入金完了した注文 (Order) の件数
 *                    (status が PAID / PROCESSING / SHIPPED / DELIVERED のもの。
 *                     PENDING / CANCELED / REFUNDED は除外)
 *
 * ランク判定は純粋ロジック (@idol/shared: resolveMemberRank) に委譲する。
 * 昇格条件 (しきい値) は AppSetting (membership.rankTiers) から取得し、管理画面で変更可能。
 *
 * 公開範囲: ファンには「現在のランク」のみ。条件は管理者専用 (このモジュールは
 * 条件そのものは返さない呼び出し側で制御する)。
 */
import { prisma } from '@idol/db';
import {
  resolveMemberRank,
  type MemberRank,
  type MemberMetrics,
  type MemberRankTiers,
} from '@idol/shared';
import { getMemberRankTiers } from './app-setting';

/** 「買い物」とみなす注文ステータス (入金完了以降・キャンセル/返金を除く) */
const PURCHASED_ORDER_STATUSES = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] as const;

/** 単一ユーザーのメトリクス (ログイン日数・買い物数) を集計する。 */
export async function getMemberMetrics(userId: string): Promise<MemberMetrics> {
  const [loginDays, purchaseCount] = await Promise.all([
    prisma.loginBonusGrant.count({ where: { userId } }),
    prisma.order.count({
      where: { userId, status: { in: [...PURCHASED_ORDER_STATUSES] } },
    }),
  ]);
  return { loginDays, purchaseCount };
}

/**
 * 単一ユーザーの現在ランクを判定する。
 * @param tiers 省略時は AppSetting から取得した条件を使う。
 */
export async function getMemberRank(
  userId: string,
  tiers?: MemberRankTiers,
): Promise<{ rank: MemberRank; metrics: MemberMetrics }> {
  const [metrics, resolvedTiers] = await Promise.all([
    getMemberMetrics(userId),
    tiers ? Promise.resolve(tiers) : getMemberRankTiers(),
  ]);
  return { rank: resolveMemberRank(metrics, resolvedTiers), metrics };
}

/** 管理一覧用: 複数ユーザーのメトリクス & ランクをまとめて集計する。 */
export async function getMemberRanksForUsers(
  userIds: string[],
  tiers?: MemberRankTiers,
): Promise<Record<string, { rank: MemberRank; metrics: MemberMetrics }>> {
  if (userIds.length === 0) return {};
  const resolvedTiers = tiers ?? (await getMemberRankTiers());

  // ログイン日数 (groupBy で 1 クエリ)
  const loginGroups = await prisma.loginBonusGrant.groupBy({
    by: ['userId'],
    where: { userId: { in: userIds } },
    _count: { _all: true },
  });
  const loginByUser = new Map<string, number>(
    loginGroups.map((g) => [g.userId, g._count._all]),
  );

  // 買い物数 (groupBy で 1 クエリ)
  const orderGroups = await prisma.order.groupBy({
    by: ['userId'],
    where: { userId: { in: userIds }, status: { in: [...PURCHASED_ORDER_STATUSES] } },
    _count: { _all: true },
  });
  const ordersByUser = new Map<string, number>(
    orderGroups.map((g) => [g.userId, g._count._all]),
  );

  const result: Record<string, { rank: MemberRank; metrics: MemberMetrics }> = {};
  for (const id of userIds) {
    const metrics: MemberMetrics = {
      loginDays: loginByUser.get(id) ?? 0,
      purchaseCount: ordersByUser.get(id) ?? 0,
    };
    result[id] = { rank: resolveMemberRank(metrics, resolvedTiers), metrics };
  }
  return result;
}
