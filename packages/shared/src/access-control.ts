import { ACCESS_LEVELS, type AccessLevelLiteral, type PlanTypeLiteral } from './constants';

const PLAN_RANK: Record<PlanTypeLiteral, number> = {
  FREE: 0,
  STANDARD: 1,
  PREMIUM: 2,
};

/**
 * 公開範囲ごとに要求されるプラン順位。
 *
 * FREE_MEMBERS は「ログインしていれば無料プランでも可」なので FREE と同じ 0。
 * ただし PUBLIC と違い未ログインは弾く必要があるため、canAccess 側で
 * PUBLIC だけを特別扱いし、それ以外はプラン (= ログイン) 必須としている。
 */
const REQUIRED_RANK: Record<AccessLevelLiteral, number> = {
  PUBLIC: 0,
  FREE_MEMBERS: 0,
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
 * そのプラン (未ログインなら undefined) で閲覧できる公開範囲の一覧。
 *
 * 一覧クエリの `accessLevel: { in: ... }` を組み立てるために使う。
 * 以前は各画面が
 *   const allowed = ['PUBLIC'];
 *   if (canAccess(plan, 'MEMBERS')) allowed.push('MEMBERS');
 *   if (canAccess(plan, 'PREMIUM')) allowed.push('PREMIUM');
 * と手書きしており、段階を増やすと 8 箇所すべてを直さない限り
 * 新しい公開範囲の記事が誰にも表示されない (静かに消える) 事故になる。
 * ACCESS_LEVELS から導出することで、追加時の直し忘れを構造的に防ぐ。
 */
export function accessibleLevels(
  plan: PlanTypeLiteral | undefined | null,
): AccessLevelLiteral[] {
  return ACCESS_LEVELS.filter((level) => canAccess(plan, level));
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

/**
 * 「◯◯会員になると視聴できます」の ◯◯ に入る、最低限必要なプラン名。
 *
 * PUBLIC / FREE_MEMBERS は有料プランを必要としない (FREE_MEMBERS はログインだけで足りる)
 * ので「無料」を返す。CTA 文言を出す側は canAccess で弾かれたときだけ使うこと。
 */
export function requiredPlanLabel(level: AccessLevelLiteral): string {
  switch (level) {
    case 'PREMIUM':
      return 'プレミアム';
    case 'MEMBERS':
      return 'スタンダード';
    default:
      return '無料';
  }
}

/**
 * その公開範囲を閲覧するのにログインが必要か。
 * PUBLIC 以外はすべて会員 (ログイン) 必須。
 */
export function requiresSignInForAccess(level: AccessLevelLiteral): boolean {
  return level !== 'PUBLIC';
}

/**
 * 公開範囲の厳しさ順位 (大きいほど限定的)。
 * 「公開範囲を狭めた」判定などに使う。
 */
export function accessLevelRank(level: AccessLevelLiteral): number {
  // FREE_MEMBERS は要求プランこそ FREE と同じだが、
  // 未ログインを弾く分 PUBLIC より厳しいので独立した順位を持たせる。
  switch (level) {
    case 'PUBLIC':
      return 0;
    case 'FREE_MEMBERS':
      return 1;
    case 'MEMBERS':
      return 2;
    case 'PREMIUM':
      return 3;
    default:
      return 0;
  }
}
