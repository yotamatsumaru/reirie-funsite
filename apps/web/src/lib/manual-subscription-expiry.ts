/**
 * manual-subscription-expiry — 期限切れの «手動付与» 契約を CANCELED にする
 *
 * 【なぜ必要か】
 * 管理画面の手動付与 (stripeSubscriptionId = 'manual_...') は Stripe を通らないため、
 * 期限 (currentPeriodEnd) が来ても Webhook でステータスが変わらない。
 *
 * プラン判定 (lib/subscription-status.ts の liveSubscriptionWhere) は期限も見るので
 * これが走らなくても有料扱いにはならないが、月次 Pui ボーナス・会報誌・売上分析などは
 * status だけを見ている。DB のステータス自体も揃えておくために定期的に実行する。
 *
 * 実行タイミング: アプリ内タイマー (instrumentation.ts → startManualSubscriptionExpiryScheduler)
 */
import { prisma } from '@idol/db';
import { logAudit } from '@/lib/audit';
import { MANUAL_SUBSCRIPTION_PREFIX, PAID_SUBSCRIPTION_STATUSES } from '@/lib/subscription-status';

export type ExpireResult = { expired: number; subscriptionIds: string[] };

/** 期限切れの手動付与を CANCELED にし、1 件ずつ監査ログを残す */
export async function expireManualSubscriptions(now: Date = new Date()): Promise<ExpireResult> {
  const targets = await prisma.subscription.findMany({
    where: {
      stripeSubscriptionId: { startsWith: MANUAL_SUBSCRIPTION_PREFIX },
      status: { in: [...PAID_SUBSCRIPTION_STATUSES] },
      currentPeriodEnd: { lte: now },
    },
    select: { id: true, userId: true, planType: true, currentPeriodEnd: true },
  });
  if (targets.length === 0) return { expired: 0, subscriptionIds: [] };

  const ids = targets.map((t) => t.id);
  // 二重実行されても同じ結果になるよう、条件付きで更新する
  await prisma.subscription.updateMany({
    where: { id: { in: ids }, status: { in: [...PAID_SUBSCRIPTION_STATUSES] } },
    data: { status: 'CANCELED', canceledAt: now, cancelAtPeriodEnd: false },
  });

  for (const t of targets) {
    await logAudit({
      userId: null, // システム処理
      action: 'subscription.manual.expire',
      resource: `subscription:${t.id}`,
      metadata: {
        subUserId: t.userId,
        planType: t.planType,
        currentPeriodEnd: t.currentPeriodEnd.toISOString(),
      },
    });
  }
  return { expired: targets.length, subscriptionIds: ids };
}

/** チェック間隔 (10 分)。期限切れの判定自体はプラン判定側で即時に効くため、ここは粗くてよい */
const CHECK_INTERVAL_MS = 10 * 60_000;

/** アプリ内タイマーを起動する (プロセスにつき 1 回だけ) */
export function startManualSubscriptionExpiryScheduler(): void {
  const g = globalThis as typeof globalThis & { __manualSubExpirySchedulerStarted?: boolean };
  if (g.__manualSubExpirySchedulerStarted) return;
  g.__manualSubExpirySchedulerStarted = true;

  const tick = async () => {
    try {
      const r = await expireManualSubscriptions();
      if (r.expired > 0) {
        // eslint-disable-next-line no-console
        console.log(`[manual-sub-expiry] expired ${r.expired} manual subscription(s)`);
      }
    } catch (e) {
      // タイマー内の例外でプロセスを落とさない。次の tick でリトライされる
      // eslint-disable-next-line no-console
      console.error('[manual-sub-expiry] tick failed', e);
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
  timer.unref?.();
}
