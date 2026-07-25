/**
 * 現在の「有効プラン」をDBのアクティブなサブスクリプションから解決するヘルパ。
 *
 * ## なぜ必要か
 * ログインセッション (JWT) の `session.user.plan` は auth.ts の jwt callback で
 * 5分間キャッシュされる。そのため Stripe Checkout で加入した直後に戻ってくると、
 * DB には ACTIVE なサブスクがあるのに JWT はまだ FREE のまま、という「反映ラグ」が
 * 発生する（マイページのプランバッジが「無料」と表示されるなど）。
 *
 * プラン表示・特典判定を行うサーバーコンポーネントでは、この関数で DB を直接見て
 * 「今この瞬間の有効プラン」を取得することで、反映ラグを解消する。
 */
import { prisma } from '@idol/db';
import type { PlanTypeLiteral } from '@idol/shared';

/** プランとして「有効」とみなすサブスクリプションステータス */
const ACTIVE_SUBSCRIPTION_STATUSES = ['ACTIVE', 'TRIALING', 'PAST_DUE'] as const;

/**
 * userId のアクティブなサブスクから有効プランを解決する（DB を正とする）。
 * アクティブなサブスクが無ければ 'FREE' を返す。
 *
 * これは auth.ts の jwt callback とまったく同じ導出ロジックのため、
 * JWT のキャッシュ (最大5分) を待たずに「今この瞬間の正しいプラン」が得られる。
 */
export async function getLivePlan(userId: string): Promise<PlanTypeLiteral> {
  const sub = await prisma.subscription.findFirst({
    where: {
      userId,
      status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
    },
    orderBy: { createdAt: 'desc' },
    select: { planType: true },
  });
  return (sub?.planType as PlanTypeLiteral) ?? 'FREE';
}
