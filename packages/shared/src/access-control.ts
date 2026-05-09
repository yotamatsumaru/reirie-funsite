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

export function requiredPlanLabel(level: AccessLevelLiteral): string {
  return level === 'PREMIUM' ? 'プレミアム' : 'スタンダード';
}
