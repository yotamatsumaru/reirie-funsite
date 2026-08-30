/**
 * プラン反映の不整合を検知する（DB 側の実装）
 *
 * ## 目的
 *   「決済は成功しているのにプランが反映されない」会員を、
 *   本人からの申告を待たずに運営側から見つけられるようにする。
 *
 * ## なぜ必要か
 *   このサイトのプラン判定は Stripe の入金ではなく DB の subscriptions を見る。
 *
 *     credentials.ts:229  plan = user.subscriptions[0] ? planType : 'FREE'
 *
 *   Webhook がユーザーを特定できないと Subscription 行が作られず、
 *   会員は決済済みでも無条件で FREE 扱いになる。
 *   従来この状態を見つける手段は「会員からの問い合わせ」しか無かった。
 *
 * ## 判定方針
 *   純粋なロジック部分は @idol/shared の detectSubscriptionMismatches に置き、
 *   ここでは DB からの材料集めに専念する（テストで境界を固定できるようにするため）。
 */
import { prisma } from '@idol/db';
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  daysSincePayment,
  detectSubscriptionMismatches,
  overallSeverity,
  type SubscriptionMismatch,
  type SubscriptionMismatchSeverity,
} from '@idol/shared';

export type MismatchedUser = {
  userId: string;
  email: string;
  displayName: string | null;
  memberNumber: string | null;
  stripeCustomerId: string | null;
  /** 決済成功しているサブスク課金の件数 */
  paymentCount: number;
  /** 直近の決済成功日時 */
  lastPaymentAt: Date | null;
  /** 支払いからの経過日数（対応の緊急度判断用） */
  daysSincePaid: number;
  /** 保持しているサブスクの status 一覧 */
  subscriptionStatuses: string[];
  mismatches: SubscriptionMismatch[];
  severity: SubscriptionMismatchSeverity;
};

/** 取りこぼした Webhook イベント（会員に紐付かなかった決済） */
export type OrphanWebhookEvent = {
  id: string;
  type: string;
  skipReason: string | null;
  stripeCustomerId: string | null;
  processedAt: Date;
};

/**
 * 「決済があるのに有効なサブスクが無い」会員を検出する。
 *
 * ### 誤検知を避けるための除外条件
 *   - 解約済み (CANCELED / INCOMPLETE_EXPIRED) の行を持つ会員は除外する。
 *     一度は正しく Subscription 行が作られていた証拠であり、
 *     「払ったのに反映されない」ケースとは別物（普通に解約した人）。
 *   - 退会済み (deletedAt) の会員は除外する。
 *
 * @param limit 返す最大件数（画面表示用。多すぎても運用できないため）
 */
export async function findMismatchedUsers(limit = 50): Promise<MismatchedUser[]> {
  // サブスク課金で決済成功している会員を集計する。
  // kind は Payment モデルの PaymentKind。サブスク以外（物販/Pui購入）は
  // プラン反映と無関係なので除外する。
  const paidGroups = await prisma.payment.groupBy({
    by: ['userId'],
    where: {
      status: 'SUCCEEDED',
      kind: 'SUBSCRIPTION',
    },
    _count: { _all: true },
    _max: { createdAt: true },
  });

  if (paidGroups.length === 0) return [];

  const userIds = paidGroups.map((g) => g.userId);

  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, deletedAt: null },
    select: {
      id: true,
      email: true,
      displayName: true,
      memberNumber: true,
      stripeCustomerId: true,
      subscriptions: { select: { status: true } },
    },
  });

  const now = new Date();
  const rows: MismatchedUser[] = [];

  for (const u of users) {
    const statuses = u.subscriptions.map((s) => s.status as string);

    // 解約済みの痕跡がある会員は「正常に記録されていた」と判断して除外。
    // これを入れないと、過去に解約した会員が全員 critical として並び、
    // 本当に困っている会員が埋もれてしまう。
    const hasClosedRecord = statuses.some(
      (s) => s === 'CANCELED' || s === 'INCOMPLETE_EXPIRED',
    );
    if (hasClosedRecord) continue;

    const group = paidGroups.find((g) => g.userId === u.id);
    const paymentCount = group?._count._all ?? 0;
    const lastPaymentAt = group?._max.createdAt ?? null;

    const mismatches = detectSubscriptionMismatches({
      succeededSubscriptionPaymentCount: paymentCount,
      lastSucceededPaymentAt: lastPaymentAt,
      subscriptionStatuses: statuses,
    });
    const severity = overallSeverity(mismatches);
    if (!severity) continue;

    rows.push({
      userId: u.id,
      email: u.email,
      displayName: u.displayName,
      memberNumber: u.memberNumber ?? null,
      stripeCustomerId: u.stripeCustomerId ?? null,
      paymentCount,
      lastPaymentAt,
      daysSincePaid: daysSincePayment(lastPaymentAt, now),
      subscriptionStatuses: statuses,
      mismatches,
      severity,
    });
  }

  // critical を先に、その中でも「待たせている日数」が長い順に並べる。
  // 運営が上から順に対応すれば、最も困っている会員から救える。
  rows.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    return b.daysSincePaid - a.daysSincePaid;
  });

  return rows.slice(0, limit);
}

/**
 * 二重契約（有効なサブスクが複数）の会員を検出する。
 *
 * 会員が二重に課金され続けるため、放置すると返金対応が必要になる。
 */
export async function findDuplicateActiveUsers(limit = 50): Promise<MismatchedUser[]> {
  const groups = await prisma.subscription.groupBy({
    by: ['userId'],
    where: { status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] } },
    _count: { _all: true },
    having: { userId: { _count: { gt: 1 } } },
  });
  if (groups.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: groups.map((g) => g.userId) }, deletedAt: null },
    select: {
      id: true,
      email: true,
      displayName: true,
      memberNumber: true,
      stripeCustomerId: true,
      subscriptions: { select: { status: true } },
    },
  });

  return users.slice(0, limit).map((u) => {
    const statuses = u.subscriptions.map((s) => s.status as string);
    const mismatches = detectSubscriptionMismatches({
      succeededSubscriptionPaymentCount: 0,
      lastSucceededPaymentAt: null,
      subscriptionStatuses: statuses,
    });
    return {
      userId: u.id,
      email: u.email,
      displayName: u.displayName,
      memberNumber: u.memberNumber ?? null,
      stripeCustomerId: u.stripeCustomerId ?? null,
      paymentCount: 0,
      lastPaymentAt: null,
      daysSincePaid: 0,
      subscriptionStatuses: statuses,
      mismatches,
      severity: overallSeverity(mismatches) ?? 'warning',
    };
  });
}

/**
 * 会員に紐付けられなかった Webhook イベントを取得する。
 *
 * これが1件でもあれば「Stripe では決済されたが、サイト側で誰のものか
 * 分からず捨てられた」ことを意味する。マイグレーション以前のイベントは
 * outcome が NULL のため対象外（当時の結果は記録されていない）。
 */
export async function findOrphanWebhookEvents(limit = 50): Promise<OrphanWebhookEvent[]> {
  const rows = await prisma.stripeWebhookEvent.findMany({
    where: { outcome: 'SKIPPED', skipReason: 'user_not_found' },
    orderBy: { processedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      type: true,
      skipReason: true,
      stripeCustomerId: true,
      processedAt: true,
    },
  });
  return rows;
}

export type SubscriptionHealthReport = {
  mismatched: MismatchedUser[];
  duplicates: MismatchedUser[];
  orphanEvents: OrphanWebhookEvent[];
  /** 対応が必要な合計件数（バッジ表示用） */
  totalIssues: number;
};

export async function buildSubscriptionHealthReport(): Promise<SubscriptionHealthReport> {
  const [mismatched, duplicates, orphanEvents] = await Promise.all([
    findMismatchedUsers(),
    findDuplicateActiveUsers(),
    findOrphanWebhookEvents(),
  ]);
  return {
    mismatched,
    duplicates,
    orphanEvents,
    // 二重契約 (duplicates) はサブスク分析ページの既存バナーで別途表示されるため、
    // ここでの件数には含めない（同じ事象を二重にカウントしないため）。
    // API 利用者向けに duplicates 自体は返す。
    totalIssues: mismatched.length + orphanEvents.length,
  };
}
