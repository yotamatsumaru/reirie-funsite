/**
 * subscription-status — «いま有料として扱う契約» の条件を一か所にまとめる
 *
 * 【なぜ必要か】
 * プラン判定は DB の subscriptions.status だけを見ていた。
 * Stripe 経由の契約は Webhook でステータスが更新されるので問題ないが、
 * 管理画面の «手動付与» (stripeSubscriptionId = 'manual_...') は Stripe を通らないため、
 * 期限 (currentPeriodEnd) が過ぎても誰も CANCELED にせず、ずっと有料のままだった。
 *
 * 【ルール】
 *  - status が ACTIVE / TRIALING / PAST_DUE の契約を有料として扱う (従来どおり)
 *  - ただし «手動付与» で期限 (currentPeriodEnd) を過ぎたものは除く
 *
 * 期限切れの手動付与は lib/manual-subscription-expiry.ts の定期処理でも
 * CANCELED に更新するが、その処理が走るまでの間も有料扱いにならないよう、
 * 判定の条件そのものに期限を入れている。
 */
import type { Prisma } from '@idol/db';

/** 有料として扱うステータス (PAST_DUE は Stripe が再請求中の猶予期間) */
export const PAID_SUBSCRIPTION_STATUSES = ['ACTIVE', 'TRIALING', 'PAST_DUE'] as const;

/** 管理画面の «手動付与» で作る契約の stripeSubscriptionId の接頭辞 */
export const MANUAL_SUBSCRIPTION_PREFIX = 'manual_';

/** 手動付与の契約か */
export function isManualSubscription(stripeSubscriptionId: string): boolean {
  return stripeSubscriptionId.startsWith(MANUAL_SUBSCRIPTION_PREFIX);
}

/**
 * 「いま有料として扱う契約」の Prisma 条件。
 *
 *   prisma.subscription.findFirst({ where: { userId, ...liveSubscriptionWhere() } })
 *   include: { subscriptions: { where: liveSubscriptionWhere() } }
 */
export function liveSubscriptionWhere(
  now: Date = new Date(),
  statuses: readonly string[] = PAID_SUBSCRIPTION_STATUSES,
): Prisma.SubscriptionWhereInput {
  return {
    status: { in: [...statuses] as Prisma.EnumSubscriptionStatusFilter['in'] },
    // 手動付与で期限切れのものは除く (NOT (manual_ AND 期限 <= now))
    NOT: {
      stripeSubscriptionId: { startsWith: MANUAL_SUBSCRIPTION_PREFIX },
      currentPeriodEnd: { lte: now },
    },
  };
}

/**
 * 1 件の契約が «いま有料として扱えるか» (DB を引いた後の判定用)。
 * liveSubscriptionWhere と同じルール。
 */
export function isLiveSubscription(
  sub: { status: string; stripeSubscriptionId: string; currentPeriodEnd: Date },
  now: Date = new Date(),
): boolean {
  if (!(PAID_SUBSCRIPTION_STATUSES as readonly string[]).includes(sub.status)) return false;
  if (isManualSubscription(sub.stripeSubscriptionId) && sub.currentPeriodEnd.getTime() <= now.getTime()) {
    return false;
  }
  return true;
}
