/**
 * 会員カード & Pui 機能の共有定義。
 *  - 会員番号フォーマット (RR-000123)
 *  - JST 基準の日付キー (ログインボーナス/シェアの 1 日判定)
 *  - Pui 付与レートのデフォルト値 & 設定スキーマ (管理画面で変更可能)
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

// シェア対象は X のみ (Instagram は 2026-07 に廃止)。
// なお Prisma の SocialPlatform enum には後方互換のため INSTAGRAM 値が残るが、
// 新規のシェア導線・付与では使用しない (過去の付与記録は保持する)。
export const SOCIAL_PLATFORMS = ['X'] as const;
export type SocialPlatformLiteral = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatformLiteral, string> = {
  X: 'X (旧Twitter)',
};

/**
 * シェアの意図 (シェアボタンを開いた) を記録してから、Pui 受取を許可するまでの
 * 最小待機秒数。実際に投稿する時間を確保させ、「開いてすぐ受取」を防ぐ。
 * また、意図の有効期限もこの日 (JST) の範囲内 (= 当日中) とする。
 */
export const SOCIAL_SHARE_MIN_DWELL_SEC = 8;

// ---------------------------------------------------------------------
// Pui 付与レート設定 (管理画面で変更可能・DB に永続化)
// ---------------------------------------------------------------------

/**
 * Pui レート設定。
 *  - loginBonusBase: 毎日のログインで付与する基本 Pui
 *  - loginStreakBonus: 連続ログインが streakThreshold 日に到達した日に上乗せする Pui
 *  - loginStreakThreshold: 連続ボーナスを付与する日数 (例: 7 日連続で +bonus)
 *  - socialSharePui: SNS シェア 1 回 (1プラットフォーム1日) で付与する Pui
 */
export const PuiRateSettingsSchema = z.object({
  loginBonusBase: z.number().int().min(0).max(100000),
  loginStreakBonus: z.number().int().min(0).max(100000),
  loginStreakThreshold: z.number().int().min(2).max(365),
  socialSharePui: z.number().int().min(0).max(100000),
});

export type PuiRateSettings = z.infer<typeof PuiRateSettingsSchema>;

/** デフォルトの Pui レート (ユーザー指定値) */
export const DEFAULT_PUI_RATES: PuiRateSettings = {
  loginBonusBase: 10, // ログイン 10 Pui/日
  loginStreakBonus: 50, // 7 日連続で +50 Pui
  loginStreakThreshold: 7,
  socialSharePui: 20, // シェア 20 Pui/日
};

/** AppSetting に保存する際のキー */
export const PUI_RATES_SETTING_KEY = 'pui.rates';

// ---------------------------------------------------------------------
// SNS シェアのテンプレート文 (管理画面で変更可能・DB に永続化)
// ---------------------------------------------------------------------

/** AppSetting に保存する際のキー (SNS シェアのテンプレート文) */
export const SHARE_TEMPLATE_SETTING_KEY = 'share.templates';

/** シェア文の最大文字数 (X の実質上限に余裕を持たせた値。URL は自動付与のため別枠) */
export const SHARE_TEMPLATE_MAX_LENGTH = 200;

/**
 * SNS シェアのテンプレート文。
 *  - x: X (旧Twitter) 共有時の本文。URL は intent の url パラメータで自動付与される。
 * 本文に URL を含める必要はない (サイト URL は自動で付与される)。
 * (Instagram は 2026-07 に廃止したため X のみ。)
 */
export const ShareTemplateSettingsSchema = z.object({
  x: z.string().trim().min(1, 'X 用のシェア文を入力してください').max(SHARE_TEMPLATE_MAX_LENGTH),
});

export type ShareTemplateSettings = z.infer<typeof ShareTemplateSettingsSchema>;

/** シェアテンプレート文の既定値 (従来ハードコードされていた文面を踏襲) */
export const DEFAULT_SHARE_TEMPLATES: ShareTemplateSettings = {
  x: '推しを応援しよう！Reirie ファンサイトはこちら',
};

/**
 * ある連続ログイン日数 (streak) のときに付与すべき Pui を計算する。
 * - 基本 loginBonusBase
 * - streak が loginStreakThreshold の倍数に到達したら loginStreakBonus を上乗せ
 */
export function computeLoginBonusAmount(
  streak: number,
  rates: PuiRateSettings,
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
  /** その日に付与される Pui */
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
 * @param rates        Pui レート設定
 */
export function buildLoginBonusCalendar(
  streak: number,
  claimedToday: boolean,
  rates: PuiRateSettings,
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
// Pui 整合性 (台帳 vs 残高) の判定ロジック
// ---------------------------------------------------------------------

/**
 * 1 取引で動かせる Pui の絶対値上限 (防御的上限)。
 * サーバ側 (apps/web/src/lib/points.ts) でも同じ値を用いて、
 * バグや不正なレート設定による異常な大量付与をブロックする。
 */
export const MAX_PUI_PER_TX = 1_000_000;

/**
 * Pui 取引の amount が安全な範囲か検証する。
 *  - 整数であること
 *  - 0 でないこと
 *  - |amount| <= MAX_PUI_PER_TX
 */
export function isValidPuiAmount(amount: number): boolean {
  return (
    Number.isInteger(amount) && amount !== 0 && Math.abs(amount) <= MAX_PUI_PER_TX
  );
}

/**
 * 保有残高と台帳合計が整合しているか判定する。
 *  - storedBalance === ledgerSum (台帳と一致)
 *  - かつ storedBalance >= 0 (残高はマイナスにならない)
 */
export function isPuiBalanceConsistent(
  storedBalance: number,
  ledgerSum: number,
): boolean {
  return storedBalance === ledgerSum && storedBalance >= 0;
}

// ---------------------------------------------------------------------
// API 入力スキーマ
// ---------------------------------------------------------------------

/**
 * SNS シェア API の入力。
 *  - action='intent': シェアボタンを開いた記録を残す (Pui はまだ付与しない)。
 *  - action='claim' : 受取。事前の intent が存在し dwell を満たす場合のみ付与。
 *
 * action 省略時は後方互換のため 'claim' として扱う (サーバー側で補完)。
 */
export const SocialShareInputSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  action: z.enum(['intent', 'claim']).optional(),
});
export type SocialShareInput = z.infer<typeof SocialShareInputSchema>;

/** 管理者による Pui 手動調整 */
export const AdminAdjustPuiSchema = z.object({
  userId: z.string().uuid(),
  amount: z.number().int().refine((n) => n !== 0, '0 以外を指定してください'),
  note: z.string().max(200).optional(),
});
export type AdminAdjustPui = z.infer<typeof AdminAdjustPuiSchema>;
