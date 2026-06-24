/**
 * 会員カード & ポイント機能の共有定義。
 *  - 会員番号フォーマット (RR-000123)
 *  - JST 基準の日付キー (ログインボーナス/シェアの 1 日判定)
 *  - ポイント付与レートのデフォルト値 & 設定スキーマ (管理画面で変更可能)
 */
import { z } from 'zod';

// ---------------------------------------------------------------------
// 会員番号 (RR-000123)
// ---------------------------------------------------------------------

export const MEMBER_NUMBER_PREFIX = 'RR-';
export const MEMBER_NUMBER_DIGITS = 6;

/** 連番から会員番号文字列を生成する (例: 123 -> "RR-000123") */
export function formatMemberNumber(seq: number): string {
  return `${MEMBER_NUMBER_PREFIX}${String(seq).padStart(MEMBER_NUMBER_DIGITS, '0')}`;
}

// ---------------------------------------------------------------------
// JST 日付キー (ログインボーナス / シェアの「1日」を JST で判定)
// ---------------------------------------------------------------------

/** 任意の Date を JST (UTC+9) の "YYYY-MM-DD" に変換する */
export function jstDateKey(date: Date = new Date()): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** JST 日付キーの「前日」を返す (連続ログイン判定用) */
export function previousJstDateKey(dateKey: string): string {
  // dateKey は JST の YYYY-MM-DD。UTC 正午を基準に 1 日引いてズレを避ける。
  const parts = dateKey.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() - 1);
  const yy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(base.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------
// SNS プラットフォーム
// ---------------------------------------------------------------------

export const SOCIAL_PLATFORMS = ['X', 'INSTAGRAM'] as const;
export type SocialPlatformLiteral = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatformLiteral, string> = {
  X: 'X (旧Twitter)',
  INSTAGRAM: 'Instagram',
};

// ---------------------------------------------------------------------
// ポイント付与レート設定 (管理画面で変更可能・DB に永続化)
// ---------------------------------------------------------------------

/**
 * ポイントレート設定。
 *  - loginBonusBase: 毎日のログインで付与する基本ポイント
 *  - loginStreakBonus: 連続ログインが streakThreshold 日に到達した日に上乗せするポイント
 *  - loginStreakThreshold: 連続ボーナスを付与する日数 (例: 7 日連続で +bonus)
 *  - socialSharePoints: SNS シェア 1 回 (1プラットフォーム1日) で付与するポイント
 */
export const PointRateSettingsSchema = z.object({
  loginBonusBase: z.number().int().min(0).max(100000),
  loginStreakBonus: z.number().int().min(0).max(100000),
  loginStreakThreshold: z.number().int().min(2).max(365),
  socialSharePoints: z.number().int().min(0).max(100000),
});

export type PointRateSettings = z.infer<typeof PointRateSettingsSchema>;

/** デフォルトのポイントレート (ユーザー指定値) */
export const DEFAULT_POINT_RATES: PointRateSettings = {
  loginBonusBase: 10, // ログイン 10pt/日
  loginStreakBonus: 50, // 7 日連続で +50pt
  loginStreakThreshold: 7,
  socialSharePoints: 20, // シェア 20pt/日
};

/** AppSetting に保存する際のキー */
export const POINT_RATES_SETTING_KEY = 'points.rates';

/**
 * ある連続ログイン日数 (streak) のときに付与すべきポイントを計算する。
 * - 基本 loginBonusBase
 * - streak が loginStreakThreshold の倍数に到達したら loginStreakBonus を上乗せ
 */
export function computeLoginBonusAmount(
  streak: number,
  rates: PointRateSettings,
): number {
  let amount = rates.loginBonusBase;
  if (
    rates.loginStreakThreshold > 0 &&
    rates.loginStreakBonus > 0 &&
    streak > 0 &&
    streak % rates.loginStreakThreshold === 0
  ) {
    amount += rates.loginStreakBonus;
  }
  return amount;
}

// ---------------------------------------------------------------------
// ログインボーナス・カレンダー (7日サイクルの視覚表示用)
// ---------------------------------------------------------------------

export type LoginBonusDayState = 'claimed' | 'today' | 'upcoming';

export type LoginBonusDay = {
  /** サイクル内の日番号 (1..threshold) */
  day: number;
  /** その日に付与されるポイント */
  amount: number;
  /** 連続ボーナスが上乗せされる節目の日か (threshold 日目) */
  isMilestone: boolean;
  /** 表示状態 */
  state: LoginBonusDayState;
};

/**
 * ログインボーナスの「7日(=loginStreakThreshold日)サイクル」表示データを構築する。
 *
 * - サイクル長は rates.loginStreakThreshold (既定 7)。
 * - 現在のサイクル内の位置を streak から算出 (1..threshold)。
 *   例) streak=1 → 1日目、streak=7 → 7日目(節目)、streak=8 → 次サイクルの1日目。
 * - claimedToday=true のとき、その位置の日は「受取済み(claimed)」となり、
 *   それより前の日も claimed として表示する。
 * - claimedToday=false のとき、現在位置 (= 今日受け取れる日) を today とし、
 *   それより前を claimed、後を upcoming とする。
 *
 * @param streak       連続ログイン日数。今日受取済みなら今日を含む値、
 *                     未受取なら「受け取れば到達する見込みの値」を渡す。
 * @param claimedToday 今日のログインボーナスを受取済みか
 * @param rates        ポイントレート設定
 */
export function buildLoginBonusCalendar(
  streak: number,
  claimedToday: boolean,
  rates: PointRateSettings,
): LoginBonusDay[] {
  const cycle = Math.max(1, rates.loginStreakThreshold);

  // サイクル内の現在位置 (1..cycle)。streak=0 のときは 1 とみなす。
  const effectiveStreak = Math.max(1, streak);
  let pos = effectiveStreak % cycle;
  if (pos === 0) pos = cycle; // ちょうど節目はサイクル末尾

  return Array.from({ length: cycle }, (_, i) => {
    const day = i + 1;
    const isMilestone = day === cycle && rates.loginStreakBonus > 0;
    const amount = rates.loginBonusBase + (isMilestone ? rates.loginStreakBonus : 0);

    let state: LoginBonusDayState;
    if (claimedToday) {
      state = day <= pos ? 'claimed' : 'upcoming';
    } else {
      if (day < pos) state = 'claimed';
      else if (day === pos) state = 'today';
      else state = 'upcoming';
    }
    return { day, amount, isMilestone, state };
  });
}

// ---------------------------------------------------------------------
// API 入力スキーマ
// ---------------------------------------------------------------------

export const SocialShareInputSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
});
export type SocialShareInput = z.infer<typeof SocialShareInputSchema>;

/** 管理者によるポイント手動調整 */
export const AdminAdjustPointsSchema = z.object({
  userId: z.string().uuid(),
  amount: z.number().int().refine((n) => n !== 0, '0 以外を指定してください'),
  note: z.string().max(200).optional(),
});
export type AdminAdjustPoints = z.infer<typeof AdminAdjustPointsSchema>;
