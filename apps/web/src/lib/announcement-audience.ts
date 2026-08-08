/**
 * お知らせの配信対象 (audience) の定義を 1 か所に集約したモジュール。
 *
 * 背景:
 *   配信対象は「だれでも / 無料会員以上 / スタンダード会員以上 / プレミアム会員のみ」
 *   の 4 段階。この判定と表示ラベルは
 *     - 作成フォーム / 編集フォーム (select の選択肢)
 *     - 管理画面の一覧 (バッジ)
 *     - 公開ページ /notices と /notices/[id] (閲覧可否)
 *     - 一斉メールの宛先抽出 (bulk-email.ts)
 *   の計 6 か所で必要になる。
 *   ここを分散させると「画面には出ているのにメールが届かない」
 *   「バッジだけ古いラベル」といった片側だけの直し忘れが必ず起きるため、
 *   単一の真実の源 (single source of truth) としてこのファイルに集約する。
 *
 * 設計方針:
 *   audience は「必要な最低プラン」への写像として表現する
 *   (requiredPlanForAudience)。こうすることで
 *   プランが将来増減しても分岐を増やさずに済み、
 *   @idol/shared の planRank による大小比較だけで判定できる。
 *
 * ⚠️ DB の enum (AnnouncementAudience) と必ず一致させること。
 *    値を増やすときは packages/db/prisma/schema.prisma の enum と
 *    マイグレーション (ALTER TYPE ... ADD VALUE) も同時に更新する。
 */
import { planRank, type PlanTypeLiteral } from '@idol/shared';

/**
 * 配信対象の一覧 (制限が緩い順)。
 * select の選択肢の並び順としてもそのまま使う。
 */
export const ANNOUNCEMENT_AUDIENCES = [
  'ALL',
  'MEMBERS',
  'STANDARD',
  'PREMIUM',
] as const;

export type AnnouncementAudienceLiteral = (typeof ANNOUNCEMENT_AUDIENCES)[number];

/**
 * 管理画面で使うラベル (運営が選ぶときの表現)。
 *
 * 「〜以上」と明記しているのは、
 * スタンダード向けのお知らせがプレミアム会員に届かない、という
 * 誤解を防ぐため (上位プランは常に含まれる)。
 */
export const AUDIENCE_LABELS: Record<AnnouncementAudienceLiteral, string> = {
  ALL: 'だれでも',
  MEMBERS: '無料会員以上',
  STANDARD: 'スタンダード会員以上',
  PREMIUM: 'プレミアム会員のみ',
};

/**
 * 選択肢に添える補足説明 (誰に届くのかを具体的に書く)。
 */
export const AUDIENCE_DESCRIPTIONS: Record<AnnouncementAudienceLiteral, string> = {
  ALL: 'ログインしていない方も含め、全員が閲覧できます（トップページにも表示されます）',
  MEMBERS: 'ログインしている会員全員が閲覧できます（無料会員を含む）',
  STANDARD: 'スタンダード会員とプレミアム会員が閲覧できます（無料会員は閲覧できません）',
  PREMIUM: 'プレミアム会員だけが閲覧できます',
};

/**
 * 一覧のバッジに使う短いラベル (幅が限られるため簡潔に)。
 */
export const AUDIENCE_SHORT_LABELS: Record<AnnouncementAudienceLiteral, string> = {
  ALL: 'だれでも',
  MEMBERS: '会員以上',
  STANDARD: 'スタンダード以上',
  PREMIUM: 'プレミアム限定',
};

export type BadgeTone = 'gray' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

/**
 * バッジの色。制限が強くなるほど目立つ色にして、
 * 「限定公開のものを間違えて全体公開した」に気付きやすくする。
 */
export const AUDIENCE_TONES: Record<AnnouncementAudienceLiteral, BadgeTone> = {
  ALL: 'info',
  MEMBERS: 'brand',
  STANDARD: 'success',
  PREMIUM: 'warning',
};

/**
 * その配信対象を閲覧するために必要な最低プラン。
 *  - ALL は未ログインでも見られるので null (プラン不要)
 *  - MEMBERS はログインさえしていればよいので FREE
 *
 * PREMIUM だけは「以上」ではなく「のみ」だが、
 * PREMIUM が最上位プランなので「PREMIUM 以上 == PREMIUM のみ」で一致する。
 * (将来さらに上位プランが増えた場合は、ここの意味を再検討すること)
 */
export function requiredPlanForAudience(
  audience: AnnouncementAudienceLiteral,
): PlanTypeLiteral | null {
  switch (audience) {
    case 'ALL':
      return null;
    case 'MEMBERS':
      return 'FREE';
    case 'STANDARD':
      return 'STANDARD';
    case 'PREMIUM':
      return 'PREMIUM';
  }
}

/**
 * 「ログインが必須か」= 未ログインでは閲覧できないか。
 */
export function requiresSignIn(audience: AnnouncementAudienceLiteral): boolean {
  return requiredPlanForAudience(audience) !== null;
}

/**
 * 「有料プランが必須か」= 無料会員では閲覧できないか。
 * (アップグレード案内を出すかどうかの判定に使う)
 */
export function requiresPaidPlan(audience: AnnouncementAudienceLiteral): boolean {
  const required = requiredPlanForAudience(audience);
  if (!required) return false;
  return planRank(required) > planRank('FREE');
}

/**
 * この閲覧者がプラン条件を満たしているか。
 *
 * ログイン状態の判定は含まない (呼び出し側で分ける) —
 * 「ログインが必要」と「プランが足りない」で案内文が変わるため。
 */
export function planSatisfiesAudience(
  audience: AnnouncementAudienceLiteral,
  plan: PlanTypeLiteral | undefined | null,
): boolean {
  const required = requiredPlanForAudience(audience);
  if (!required) return true;
  if (!plan) return false;
  return planRank(plan) >= planRank(required);
}

/**
 * メール送信の宛先を絞るための「対象プラン一覧」。
 *
 * bulk-email.ts で `subscriptions.some({ planType: { in: [...] } })`
 * に渡す。null の場合はプランでの絞り込みが不要
 * (= 全会員、もしくは opt-in のみ) を意味する。
 */
export function planTypesForAudience(
  audience: AnnouncementAudienceLiteral,
): PlanTypeLiteral[] | null {
  const required = requiredPlanForAudience(audience);
  // ALL / MEMBERS はプラン不問 (FREE 会員も対象)
  if (!required || required === 'FREE') return null;
  const requiredRank = planRank(required);
  return (['FREE', 'STANDARD', 'PREMIUM'] as const).filter(
    (p) => planRank(p) >= requiredRank,
  );
}

/**
 * 配信対象の「制限の強さ」。値が大きいほど閲覧できる人が少ない。
 *
 * 用途:
 *   公開済みのお知らせで配信対象を狭める変更 (例: だれでも → プレミアムのみ)
 *   を検知して警告を出す。すでに読めていた会員が急に見られなくなるため。
 */
export function audienceRank(audience: AnnouncementAudienceLiteral): number {
  return ANNOUNCEMENT_AUDIENCES.indexOf(audience);
}

/**
 * 閲覧できなかったときの案内見出し。
 * /notices/[id] のアップグレード案内で使う。
 */
export function upgradeHeadingForAudience(
  audience: AnnouncementAudienceLiteral,
): string {
  return audience === 'PREMIUM'
    ? 'このお知らせはプレミアム会員限定です'
    : 'このお知らせはスタンダード会員以上限定です';
}

/**
 * 未知の値 (DB に古い値が残っている等) を安全に扱うための型ガード。
 * enum 追加前に保存されたレコードで画面が落ちないようにする。
 */
export function isAnnouncementAudience(
  value: unknown,
): value is AnnouncementAudienceLiteral {
  return (
    typeof value === 'string' &&
    (ANNOUNCEMENT_AUDIENCES as readonly string[]).includes(value)
  );
}
