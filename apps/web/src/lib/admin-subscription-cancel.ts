/**
 * admin-subscription-cancel — 管理画面からの解約を Stripe にも反映する
 *
 * 【以前の問題】
 * /api/super-admin/subscriptions/[id] の「即時解約」「期末解約」は DB を書き換えるだけで、
 * Stripe には何も送っていなかった。そのため
 *   - 会員への請求が続く
 *   - 次の更新で Stripe から customer.subscription.updated が届き、ステータスが
 *     ACTIVE に戻って有料プランが復活する
 * という状態になっていた。
 *
 * 【方針】
 *  - Stripe 経由の契約: 先に Stripe を解約し、成功してから DB を更新する
 *    (Stripe が失敗したのに DB だけ解約済みになるのを防ぐ)
 *  - 手動付与 (manual_...): Stripe に契約が無いので DB だけ更新する
 *  - Stripe に契約が見つからない (resource_missing): 既に Stripe 側で消えているので DB だけ更新する
 *  - プラン変更の予約 (Subscription Schedule) が付いていると Stripe は解約設定の変更を拒否するため、
 *    先に予約を解除 (release) する
 */
import type Stripe from 'stripe';
import { prisma } from '@idol/db';
import { isManualSubscription } from '@/lib/subscription-status';

/** テストで差し替えられるよう、使う Stripe API だけを型にする */
export type StripeSubscriptionApi = {
  subscriptions: Pick<Stripe['subscriptions'], 'cancel' | 'update'>;
  subscriptionSchedules: Pick<Stripe['subscriptionSchedules'], 'release'>;
};

export type CancelTarget = {
  id: string;
  stripeSubscriptionId: string;
  stripeScheduleId: string | null;
};

export type CancelAction =
  | { action: 'cancel_immediate' }
  | { action: 'cancel_at_period_end'; value: boolean };

export type CancelOutcome = {
  /** Stripe 側をどう扱ったか */
  stripe: 'canceled' | 'updated' | 'skipped_manual' | 'missing_in_stripe';
  /** プラン変更の予約を解除したか */
  releasedSchedule: boolean;
};

/** Stripe の «そのリソースは存在しない» エラーか */
export function isStripeResourceMissing(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'resource_missing'
  );
}

async function releaseScheduleIfAny(
  stripe: StripeSubscriptionApi,
  scheduleId: string | null,
): Promise<boolean> {
  if (!scheduleId) return false;
  try {
    await stripe.subscriptionSchedules.release(scheduleId);
    return true;
  } catch (err) {
    // 既に解除・完了済みのスケジュールは無視してよい
    if (isStripeResourceMissing(err)) return false;
    const msg = err instanceof Error ? err.message : String(err);
    if (/released|completed|canceled/i.test(msg)) return false;
    throw err;
  }
}

/**
 * 管理者による解約操作を Stripe と DB の両方に反映する。
 * Stripe の呼び出しが失敗した場合は DB を変更せずに例外を投げる。
 */
export async function applyAdminCancel(
  sub: CancelTarget,
  input: CancelAction,
  getStripe: () => Promise<StripeSubscriptionApi>,
  now: Date = new Date(),
): Promise<CancelOutcome> {
  let stripeResult: CancelOutcome['stripe'] = 'skipped_manual';
  let releasedSchedule = false;

  if (!isManualSubscription(sub.stripeSubscriptionId)) {
    const stripe = await getStripe();
    // 解約するとき (即時 / 期末予約) は、プラン変更の予約を先に外す
    const cancelling = input.action === 'cancel_immediate' || input.value === true;
    if (cancelling) {
      releasedSchedule = await releaseScheduleIfAny(stripe, sub.stripeScheduleId);
    }
    try {
      if (input.action === 'cancel_immediate') {
        await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
        stripeResult = 'canceled';
      } else {
        await stripe.subscriptions.update(sub.stripeSubscriptionId, {
          cancel_at_period_end: input.value,
        });
        stripeResult = 'updated';
      }
    } catch (err) {
      if (!isStripeResourceMissing(err)) throw err;
      // Stripe 側に契約が無い (既に削除済み / テスト・本番の切り替え等)。DB だけ揃える
      stripeResult = 'missing_in_stripe';
    }
  }

  if (input.action === 'cancel_immediate') {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: 'CANCELED',
        canceledAt: now,
        cancelAtPeriodEnd: false,
        scheduledPlanType: null,
        stripeScheduleId: null,
      },
    });
  } else {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        cancelAtPeriodEnd: input.value,
        ...(releasedSchedule ? { scheduledPlanType: null, stripeScheduleId: null } : {}),
      },
    });
  }

  return { stripe: stripeResult, releasedSchedule };
}
