import type { AccessLevelLiteral, PlanTypeLiteral } from './constants';

const PLAN_RANK: Record<PlanTypeLiteral, number> = {
  FREE: 0,
  STANDARD: 1,
  PREMIUM: 2,
};

const REQUIRED_RANK: Record<AccessLevelLiteral, number> = {
  PUBLIC: 0,
  MEMBERS: 1,
  PREMIUM: 2,
};

/**
 * ユーザーのプラン (もしくは未認証) でアクセス可否を判定する
 */
export function canAccess(
  userPlan: PlanTypeLiteral | undefined | null,
  requiredLevel: AccessLevelLiteral,
): boolean {
  if (requiredLevel === 'PUBLIC') return true;
  if (!userPlan) return false;
  return PLAN_RANK[userPlan] >= REQUIRED_RANK[requiredLevel];
}

export function planRank(plan: PlanTypeLiteral): number {
  return PLAN_RANK[plan];
}

/**
 * EC (物販) を利用できるプランか判定する。
 * 無料会員 (FREE) は買い物ができない。スタンダード以上のみ購入可能。
 * 未認証 (null/undefined) も購入不可。
 */
export function canUseShop(plan: PlanTypeLiteral | undefined | null): boolean {
  if (!plan) return false;
  return PLAN_RANK[plan] >= PLAN_RANK.STANDARD;
}

export function requiredPlanLabel(level: AccessLevelLiteral): string {
  return level === 'PREMIUM' ? 'プレミアム' : 'スタンダード';
}
