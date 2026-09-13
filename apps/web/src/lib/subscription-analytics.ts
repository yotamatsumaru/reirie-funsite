/**
 * /super-admin/subscriptions (サブスク分析ダッシュボード) の集計ロジック
 *
 * ## なぜ分離したか
 *
 * 以前はページコンポーネント (page.tsx) が `prisma.subscription.findMany()` で
 * **全期間・全件のサブスクリプション** を `user` / `payments` 込みで一括取得し、
 * KPI・プラン別内訳・12ヶ月推移・重複契約検出・返金済み判定・下部一覧の
 * フィルタリングをすべて Node.js のメモリ上で行っていた。
 * 契約数が増えるほどページの読み込みが線形に重くなる問題があったため、
 * 集計を DB 側 (groupBy / count / 生SQL) に寄せるようにリファクタリングした。
 *
 * ## 設計方針
 *
 *  - KPI・プラン別内訳・12ヶ月推移などの「分析」部分は、依然として
 *    "全期間" のデータに基づく必要がある (直近だけを見ても意味がないため)。
 *    ただし DB 側で集計すれば、全行を Node.js に転送する必要はない。
 *  - 「返金済み判定」「重複契約検出」は元々 payments / subscriptions の
 *    一部の行だけが該当する (通常は少数) ため、該当 ID の集合だけを
 *    DB 側の GROUP BY / HAVING で求める。全件フェッチしてから
 *    JS でフィルタするより大幅に軽い。
 *  - 下部の「契約一覧」テーブルは分析目的ではなく操作目的なので、
 *    DB レベルのフィルタ (status / plan) + ページングにする
 *    (listSubscriptionsPage)。
 */
import { prisma } from '@idol/db';
import { PLAN_PRICES, PLAN_TYPES, type PlanTypeLiteral } from '@idol/shared';

/** 有効（=売上に寄与している）とみなすステータス */
export const LIVE_STATUSES = ['ACTIVE', 'TRIALING'] as const;

function ymKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** プラン別・課金サイクル別の「月次換算」単価（円） */
function monthlyValue(planType: PlanTypeLiteral, interval: 'MONTH' | 'YEAR'): number {
  const price = PLAN_PRICES[planType];
  if (!price) return 0;
  return interval === 'YEAR' ? Math.round(price.yearly / 12) : price.monthly;
}

/**
 * 「返金済み」とみなす契約の ID 集合を求める。
 *
 * 判定条件: その契約に紐づく課金のうち「成功 (SUCCEEDED) が1件も無く、
 * 返金 (REFUNDED) が1件以上ある」場合。
 *
 * 全契約 + 全課金を Node.js に読み込んで JS でループする代わりに、
 * payments テーブル側で subscription_id ごとに GROUP BY / HAVING し、
 * 該当する ID だけを DB 側で絞り込む。該当件数は通常ごく少数のため、
 * 返す Set も小さく保たれる。
 */
export async function getRefundedSubscriptionIds(): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT subscription_id::text AS id
    FROM payments
    WHERE subscription_id IS NOT NULL
    GROUP BY subscription_id
    HAVING bool_or(status = 'REFUNDED') AND NOT bool_or(status = 'SUCCEEDED')
  `;
  return new Set(rows.map((r) => r.id));
}

export type DuplicateSubscriptionUser = {
  userId: string;
  email: string;
  displayName: string | null;
  count: number;
};

/**
 * 同一ユーザーが有効 (ACTIVE/TRIALING) な契約を複数持っているユーザーを検出する。
 * 返金済み契約は既に解決済みとして除外する。
 *
 * groupBy + having で「複数持っているユーザー」だけを DB 側で絞り込むため、
 * 全契約を読み込む必要が無い。
 */
export async function findDuplicateLiveUsers(
  refundedSubIds: Set<string>,
): Promise<DuplicateSubscriptionUser[]> {
  const groups = await prisma.subscription.groupBy({
    by: ['userId'],
    where: {
      status: { in: [...LIVE_STATUSES] },
      id: refundedSubIds.size ? { notIn: [...refundedSubIds] } : undefined,
    },
    _count: { _all: true },
    having: { userId: { _count: { gt: 1 } } },
  });
  if (groups.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: groups.map((g) => g.userId) } },
    select: { id: true, email: true, displayName: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  return groups.map((g) => {
    const u = userById.get(g.userId);
    return {
      userId: g.userId,
      email: u?.email ?? '—',
      displayName: u?.displayName ?? '（不明）',
      count: g._count._all,
    };
  });
}

export type PlanStat = { count: number; mrr: number; monthCount: number; yearCount: number };
export type PlanStatsByPlan = Record<PlanTypeLiteral, PlanStat>;

/** groupBy(['planType','billingInterval']) の結果から表示用のプラン別内訳を組み立てる。 */
export function buildPlanStats(
  groups: Array<{ planType: PlanTypeLiteral; billingInterval: 'MONTH' | 'YEAR'; count: number }>,
): { planStats: PlanStatsByPlan; totalMrr: number } {
  const planStats = Object.fromEntries(
    PLAN_TYPES.map((p) => [p, { count: 0, mrr: 0, monthCount: 0, yearCount: 0 }]),
  ) as PlanStatsByPlan;

  for (const g of groups) {
    const st = planStats[g.planType];
    if (!st) continue;
    st.count += g.count;
    st.mrr += monthlyValue(g.planType, g.billingInterval) * g.count;
    if (g.billingInterval === 'YEAR') st.yearCount += g.count;
    else st.monthCount += g.count;
  }
  const totalMrr = planStats.STANDARD.mrr + planStats.PREMIUM.mrr;
  return { planStats, totalMrr };
}

export type MonthlyTrendPoint = { key: string; joins: number; churns: number };

/** 直近12ヶ月 (今月含む) の年月キー一覧を古い順で返す。 */
export function buildTrendMonthKeys(now: Date): string[] {
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    months.push(ymKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  return months;
}

/** date_trunc('month', ...) の生SQL結果を年月キーごとの件数マップに変換する。 */
function bucketByMonth(rows: Array<{ month: Date; count: bigint | number }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(ymKey(new Date(r.month)), Number(r.count));
  }
  return map;
}

/**
 * 直近12ヶ月の「新規加入」「解約」の月次推移を DB 側で集計する。
 *
 * 12ヶ月より前の契約も (その月に加入した実績として) トレンドの母数になり得るため、
 * ここは意図的に「直近12ヶ月に created_at / canceled_at が入る行」だけを対象にした
 * 範囲クエリにする (全件フェッチはしないが、直近12ヶ月分の集計としては全期間データが要る)。
 */
export async function getMonthlyTrend(now: Date): Promise<MonthlyTrendPoint[]> {
  const months = buildTrendMonthKeys(now);
  const rangeStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const [joinRows, churnRows] = await Promise.all([
    prisma.$queryRaw<Array<{ month: Date; count: bigint }>>`
      SELECT date_trunc('month', "created_at") AS month, COUNT(*)::bigint AS count
      FROM subscriptions
      WHERE "created_at" >= ${rangeStart}
      GROUP BY month
      ORDER BY month ASC
    `,
    prisma.$queryRaw<Array<{ month: Date; count: bigint }>>`
      SELECT date_trunc('month', "canceled_at") AS month, COUNT(*)::bigint AS count
      FROM subscriptions
      WHERE "canceled_at" >= ${rangeStart}
      GROUP BY month
      ORDER BY month ASC
    `,
  ]);

  const joinsByMonth = bucketByMonth(joinRows);
  const churnsByMonth = bucketByMonth(churnRows);

  return months.map((key) => ({
    key,
    joins: joinsByMonth.get(key) ?? 0,
    churns: churnsByMonth.get(key) ?? 0,
  }));
}

export type SubscriptionKpis = {
  /** 有効 (ACTIVE/TRIALING) かつ返金済みでない契約数 */
  activeCount: number;
  newThisMonth: number;
  churnedThisMonth: number;
  activeAtMonthStart: number;
  churnRate: number;
};

export type SubscriptionAnalytics = {
  kpis: SubscriptionKpis;
  planStats: PlanStatsByPlan;
  totalMrr: number;
  trend: MonthlyTrendPoint[];
  scheduledCancels: number;
  duplicateUsers: DuplicateSubscriptionUser[];
  /** ステータス別件数 (全期間)。ACTIVE / TRIALING は返金済みを除いた実効件数。 */
  statusCounts: Record<string, number>;
  refundedCount: number;
  /** 全契約数 (全ステータス・全期間)。ヘッダー表示用。 */
  totalSubscriptionCount: number;
  /** 返金済み契約の ID 集合。呼び出し側 (下部一覧のページング取得) で再利用し、二重にクエリを発行しないようにする。 */
  refundedSubIds: Set<string>;
  /** 二重契約が疑われるユーザー ID 集合。同上の理由で呼び出し側に渡す。 */
  duplicateUserIds: Set<string>;
};

/**
 * サブスク分析ダッシュボードに必要な集計を一括で行う。
 *
 * 内部で発行するクエリはいずれも count / groupBy / 集計SQL であり、
 * 契約テーブルの行を丸ごと Node.js に転送するクエリは含まない
 * (返金済み ID・重複ユーザー ID の集合を除き、これらも該当件数分のみ)。
 */
export async function getSubscriptionAnalytics(now: Date = new Date()): Promise<SubscriptionAnalytics> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const refundedSubIds = await getRefundedSubscriptionIds();
  const refundedNotIn = refundedSubIds.size ? { notIn: [...refundedSubIds] } : undefined;

  const [
    activeCount,
    newThisMonth,
    churnedThisMonth,
    planGroups,
    trend,
    scheduledCancels,
    duplicateUsers,
    rawStatusGroups,
    effectiveActive,
    effectiveTrialing,
    totalSubscriptionCount,
  ] = await Promise.all([
    prisma.subscription.count({
      where: { status: { in: [...LIVE_STATUSES] }, id: refundedNotIn },
    }),
    prisma.subscription.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.subscription.count({ where: { canceledAt: { gte: monthStart } } }),
    prisma.subscription.groupBy({
      by: ['planType', 'billingInterval'],
      where: { status: { in: [...LIVE_STATUSES] }, id: refundedNotIn },
      _count: { _all: true },
    }),
    getMonthlyTrend(now),
    prisma.subscription.count({
      where: { status: { in: [...LIVE_STATUSES] }, cancelAtPeriodEnd: true, id: refundedNotIn },
    }),
    findDuplicateLiveUsers(refundedSubIds),
    prisma.subscription.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.subscription.count({ where: { status: 'ACTIVE', id: refundedNotIn } }),
    prisma.subscription.count({ where: { status: 'TRIALING', id: refundedNotIn } }),
    prisma.subscription.count(),
  ]);

  const activeAtMonthStart = Math.max(0, activeCount - newThisMonth + churnedThisMonth);
  const churnRate = activeAtMonthStart > 0 ? (churnedThisMonth / activeAtMonthStart) * 100 : 0;

  const { planStats, totalMrr } = buildPlanStats(
    planGroups.map((g) => ({
      planType: g.planType as PlanTypeLiteral,
      billingInterval: g.billingInterval as 'MONTH' | 'YEAR',
      count: g._count._all,
    })),
  );

  const statusCounts: Record<string, number> = {};
  for (const g of rawStatusGroups) {
    statusCounts[g.status as string] = g._count._all;
  }
  // ACTIVE / TRIALING は返金済みを除いた実効件数で上書きする。
  statusCounts.ACTIVE = effectiveActive;
  statusCounts.TRIALING = effectiveTrialing;

  return {
    kpis: { activeCount, newThisMonth, churnedThisMonth, activeAtMonthStart, churnRate },
    planStats,
    totalMrr,
    trend,
    scheduledCancels,
    duplicateUsers,
    statusCounts,
    refundedCount: refundedSubIds.size,
    totalSubscriptionCount,
    refundedSubIds,
    duplicateUserIds: new Set(duplicateUsers.map((d) => d.userId)),
  };
}

export type SubscriptionListRow = {
  id: string;
  userId: string;
  planType: PlanTypeLiteral;
  billingInterval: 'MONTH' | 'YEAR';
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  canceledAt: Date | null;
  createdAt: Date;
  user: { id: string; email: string; displayName: string | null } | null;
  /** この契約が返金済みか (バッジ表示用) */
  refunded: boolean;
  /** このユーザーが有効な契約を複数持っているか (二重契約バッジ表示用) */
  duplicateLive: boolean;
};

/**
 * 「契約一覧 / 操作」テーブル用に、ステータス・プランで絞り込んだ上で
 * DB レベルでページングして取得する。
 *
 * refundedSubIds / duplicateUserIds は getSubscriptionAnalytics 側で
 * 既に計算済みの集合を渡してもらう想定 (呼び出し側で二重計算しないため)。
 */
export async function listSubscriptionsPage(params: {
  statusFilter?: string;
  planFilter?: string;
  page: number;
  pageSize: number;
  refundedSubIds: Set<string>;
  duplicateUserIds: Set<string>;
}): Promise<{ rows: SubscriptionListRow[]; total: number }> {
  const { statusFilter, planFilter, page, pageSize, refundedSubIds, duplicateUserIds } = params;

  const where = {
    ...(statusFilter ? { status: statusFilter as never } : {}),
    ...(planFilter ? { planType: planFilter as never } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.subscription.findMany({
      where,
      include: { user: { select: { id: true, email: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.subscription.count({ where }),
  ]);

  return {
    total,
    rows: (rows as unknown as Omit<SubscriptionListRow, 'refunded' | 'duplicateLive'>[]).map((s) => ({
      ...s,
      refunded: refundedSubIds.has(s.id),
      duplicateLive: duplicateUserIds.has(s.userId) && (LIVE_STATUSES as readonly string[]).includes(s.status),
    })),
  };
}
