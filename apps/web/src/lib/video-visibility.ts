/**
 * 動画の「一覧に出すか」「再生させるか」の判定を 1 箇所に集約する。
 *
 * ## なぜ分けるのか（重要）
 *
 * 無料プランでも **サムネイルは見せたい / 再生はさせない** という要件があるため、
 * 可視性は 2 段階に分かれる。
 *
 *   1. 一覧に出るか（listable）… プランに関係なく、公開中の動画なら出す
 *   2. 再生できるか（playable）… プランが accessLevel を満たすときだけ
 *
 * 従来は一覧クエリと再生 API が別々に条件を持っていて、
 * 「一覧では出るのに再生 API が 404」「その逆」というズレが起きやすかった。
 * ここに純粋関数として置き、サーバー側の一覧・詳細・API から同じ関数を使う。
 *
 * ## 公開判定に使う 3 つの軸
 *
 *   - `isPublished` … 運営の公開スイッチ（動画ごとの公開/非公開）
 *   - `status`      … エンコードが終わっているか（READY のみ再生可能）
 *   - `publishedAt` / `expiresAt` … 公開開始・終了の期間
 *
 * `status` と `isPublished` を別に持つ理由は、status がエンコードの進行状況を
 * 表すものであり、運営の意思（見せる/見せない）とは別軸だから。
 */
import { canAccess } from '@idol/shared';
import type { PlanTypeLiteral, AccessLevelLiteral } from '@idol/shared';

/** 判定に必要な最小のフィールド */
export type VideoVisibilityInput = {
  isPublished: boolean;
  status: string;
  publishedAt: Date | null;
  expiresAt: Date | null;
  accessLevel: AccessLevelLiteral;
};

/**
 * 会員向け一覧・詳細に表示してよいか。
 *
 * プランは見ない（無料プランにもサムネイルを見せるため）。
 */
export function isVideoListable(v: VideoVisibilityInput, now: Date = new Date()): boolean {
  if (!v.isPublished) return false;
  if (v.status !== 'READY') return false;
  if (!v.publishedAt || v.publishedAt > now) return false;
  if (v.expiresAt && v.expiresAt <= now) return false;
  return true;
}

/** 配信許諾期限が切れているか */
export function isVideoExpired(v: VideoVisibilityInput, now: Date = new Date()): boolean {
  return v.expiresAt != null && v.expiresAt <= now;
}

/**
 * 実際に再生（HLS 取得）を許してよいか。
 *
 * 一覧に出る条件をすべて満たし、かつプランが accessLevel を満たす場合のみ true。
 */
export function isVideoPlayable(
  v: VideoVisibilityInput,
  plan: PlanTypeLiteral | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!isVideoListable(v, now)) return false;
  return canAccess(plan, v.accessLevel);
}

/** 一覧に出るが再生はできない（= サムネイルのみ / 鍵付き）状態か */
export function isVideoLocked(
  v: VideoVisibilityInput,
  plan: PlanTypeLiteral | null | undefined,
  now: Date = new Date(),
): boolean {
  return isVideoListable(v, now) && !isVideoPlayable(v, plan, now);
}

/**
 * 再生できない理由をユーザー向け文言で返す。再生可能なら null。
 *
 * UI（詳細ページのロック表示）と API のエラーメッセージで同じ文言を使うため、
 * ここに集約する。
 */
export function videoLockReason(
  v: VideoVisibilityInput,
  plan: PlanTypeLiteral | null | undefined,
  now: Date = new Date(),
): string | null {
  if (isVideoPlayable(v, plan, now)) return null;
  if (isVideoExpired(v, now)) return 'この動画の配信期間は終了しました。';
  if (v.accessLevel === 'PREMIUM') return 'この動画はプレミアムプラン限定です。';
  if (v.accessLevel === 'MEMBERS') return 'この動画は会員限定です。';
  return 'この動画は現在再生できません。';
}

/**
 * 会員向け一覧クエリ用の Prisma where 句。
 *
 * `isVideoListable` と条件を一致させること（片方だけ直すとズレる）。
 */
export function listableVideoWhere(now: Date = new Date()) {
  return {
    isPublished: true,
    status: 'READY' as const,
    publishedAt: { not: null, lte: now },
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}
