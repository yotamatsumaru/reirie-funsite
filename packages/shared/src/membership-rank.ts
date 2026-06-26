/**
 * 会員ランク (5段階) の純粋ロジック & 定数。
 *
 * ランク: ブロンズ < シルバー < ゴールド < プラチナ < ダイヤ
 *
 * 判定基準 (AND 条件):
 *  - ログイン日数 (loginDays)   … LoginBonusGrant の件数 (毎日のログイン記録)
 *  - 買い物数 (purchaseCount)   … 入金完了した注文の件数
 *  「loginDays >= 必要ログイン日数 かつ purchaseCount >= 必要買い物数」を
 *  満たす最上位ランクを適用する。
 *
 * 公開範囲:
 *  - ファン (会員) には「現在のランク」のみ表示する。
 *  - 「昇格条件」(しきい値) は非公開。管理者のみが編集・閲覧できる。
 *
 * 設定は AppSetting (membership.rankTiers) に JSON で永続化し、管理画面から変更可能。
 * ここには副作用のない関数のみを置く (DB アクセスは含めない)。
 */

import { z } from 'zod';

// ---------------------------------------------------------------------
// ランク定義
// ---------------------------------------------------------------------

/** ランク ID (内部値)。下位 → 上位の順。 */
export const MEMBER_RANKS = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'] as const;
export type MemberRank = (typeof MEMBER_RANKS)[number];

/** ランク表示名 (日本語) */
export const MEMBER_RANK_LABELS: Record<MemberRank, string> = {
  BRONZE: 'ブロンズ',
  SILVER: 'シルバー',
  GOLD: 'ゴールド',
  PLATINUM: 'プラチナ',
  DIAMOND: 'ダイヤ',
};

/** ランクの序列 (大きいほど上位)。比較・最上位判定に使う。 */
export const MEMBER_RANK_ORDER: Record<MemberRank, number> = {
  BRONZE: 0,
  SILVER: 1,
  GOLD: 2,
  PLATINUM: 3,
  DIAMOND: 4,
};

/** 最下位ランク (条件未達のデフォルト) */
export const DEFAULT_MEMBER_RANK: MemberRank = 'BRONZE';

/** ランクのテーマ色 (UI バッジ用のトーン) */
export const MEMBER_RANK_TONE: Record<MemberRank, string> = {
  BRONZE: 'amber',
  SILVER: 'gray',
  GOLD: 'gold',
  PLATINUM: 'cyan',
  DIAMOND: 'violet',
};

// ---------------------------------------------------------------------
// 昇格条件 (しきい値) — 管理画面で変更可能
// ---------------------------------------------------------------------

/** 1 ランク分の昇格条件 (AND)。最下位 BRONZE は常に 0/0。 */
export type MemberRankCondition = {
  /** 必要ログイン日数 (>=) */
  minLoginDays: number;
  /** 必要買い物数 (>=) */
  minPurchases: number;
};

/** 全ランクの昇格条件マップ */
export type MemberRankTiers = Record<MemberRank, MemberRankCondition>;

/** AppSetting に保存するキー */
export const MEMBER_RANK_TIERS_KEY = 'membership.rankTiers';

/**
 * 既定の昇格条件。
 *  - BRONZE   : 0 / 0   (誰でも)
 *  - SILVER   : ログイン 10 日  かつ 買い物 1 回
 *  - GOLD     : ログイン 30 日  かつ 買い物 3 回
 *  - PLATINUM : ログイン 90 日  かつ 買い物 5 回
 *  - DIAMOND  : ログイン 180 日 かつ 買い物 10 回
 */
export const DEFAULT_MEMBER_RANK_TIERS: MemberRankTiers = {
  BRONZE: { minLoginDays: 0, minPurchases: 0 },
  SILVER: { minLoginDays: 10, minPurchases: 1 },
  GOLD: { minLoginDays: 30, minPurchases: 3 },
  PLATINUM: { minLoginDays: 90, minPurchases: 5 },
  DIAMOND: { minLoginDays: 180, minPurchases: 10 },
};

// ---------------------------------------------------------------------
// 判定ロジック (純粋関数)
// ---------------------------------------------------------------------

/** 会員の実績メトリクス */
export type MemberMetrics = {
  /** ログイン日数 */
  loginDays: number;
  /** 買い物 (入金完了注文) 数 */
  purchaseCount: number;
};

/** 値が有効なランク ID か */
export function isMemberRank(v: unknown): v is MemberRank {
  return typeof v === 'string' && (MEMBER_RANKS as readonly string[]).includes(v);
}

/**
 * メトリクスと条件から、満たす最上位ランクを判定する。
 *  - 上位ランクから順に「loginDays >= minLoginDays かつ purchaseCount >= minPurchases」を確認。
 *  - どれも満たさなければ最下位 (BRONZE)。
 */
export function resolveMemberRank(
  metrics: MemberMetrics,
  tiers: MemberRankTiers = DEFAULT_MEMBER_RANK_TIERS,
): MemberRank {
  // 上位 → 下位の順で最初に満たすものを返す
  const ordered = [...MEMBER_RANKS].sort(
    (a, b) => MEMBER_RANK_ORDER[b] - MEMBER_RANK_ORDER[a],
  );
  for (const rank of ordered) {
    const cond = tiers[rank] ?? DEFAULT_MEMBER_RANK_TIERS[rank];
    if (
      metrics.loginDays >= cond.minLoginDays &&
      metrics.purchaseCount >= cond.minPurchases
    ) {
      return rank;
    }
  }
  return DEFAULT_MEMBER_RANK;
}

/**
 * 壊れた / 部分的な設定を補完して完全な tiers にする。
 * 欠落ランクは既定値で埋め、BRONZE は常に 0/0 に正規化する。
 */
export function normalizeMemberRankTiers(
  partial: Partial<MemberRankTiers> | null | undefined,
): MemberRankTiers {
  const result = {} as MemberRankTiers;
  for (const rank of MEMBER_RANKS) {
    const c = partial?.[rank];
    result[rank] =
      rank === 'BRONZE'
        ? { minLoginDays: 0, minPurchases: 0 }
        : {
            minLoginDays: Math.max(0, Math.floor(c?.minLoginDays ?? DEFAULT_MEMBER_RANK_TIERS[rank].minLoginDays)),
            minPurchases: Math.max(0, Math.floor(c?.minPurchases ?? DEFAULT_MEMBER_RANK_TIERS[rank].minPurchases)),
          };
  }
  return result;
}

// ---------------------------------------------------------------------
// Zod スキーマ (管理画面の入力検証)
// ---------------------------------------------------------------------

const MemberRankConditionSchema = z.object({
  minLoginDays: z.number().int().min(0).max(100000),
  minPurchases: z.number().int().min(0).max(100000),
});

/** 全ランクの条件マップ (5 ランクすべて必須) */
export const MemberRankTiersSchema = z.object(
  Object.fromEntries(
    MEMBER_RANKS.map((r) => [r, MemberRankConditionSchema]),
  ) as Record<MemberRank, typeof MemberRankConditionSchema>,
) as unknown as z.ZodType<MemberRankTiers>;
