/**
 * login-bonus-app — スマホアプリ向けログインボーナス情報の組み立て
 *
 * 【背景 / アプリ担当者からの要望】
 * アプリで 7 日スタンプカードを作ったが、各日の獲得額が API から返らないため
 * 金額を表示できない、という要望を受けて追加した。
 *
 * 【注意: 要望に書かれていた想定値は実装と違っていた】
 * 要望では schedule の例として [10,10,10,20,20,20,50] が挙げられていたが、
 * 実際の付与ロジック (computeLoginBonusAmount) は
 *
 *   ・毎日 loginBonusBase (既定 10)
 *   ・loginStreakThreshold (既定 7) の倍数の日に loginStreakBonus (既定 50) を上乗せ
 *
 * なので、実際は [10,10,10,10,10,10,60] になる。
 * 途中の日が段階的に増えることはない。ここを固定値で持つと «表示は 20 なのに
 * 実際は 10 しか増えない» という不信につながるため、必ずサーバーの
 * レート設定から算出する。
 *
 * 【さらに: プランで金額が変わる】
 * 付与時に applyPlanPuiMultiplier でプラン倍率がかかる
 * (FREE ×1.0 / STANDARD ×1.2 / PREMIUM ×2.0)。
 * つまり PREMIUM 会員は 7 日目に 120 Pui もらえる。
 * schedule をプラン非依存で返すと «表示より多く/少なく» もらえることになるので、
 * 「そのユーザーが実際に受け取る額」を返す。
 */

import { buildLoginBonusCalendar, type PuiRateSettings } from './membership';
import { applyPlanPuiMultiplier } from './plan-benefits';
import type { PlanTypeLiteral } from './constants';

/** アプリのスタンプカード 1 マス分 */
export type LoginBonusScheduleDay = {
  /** サイクル内の日番号 (1..cycleLength) */
  day: number;
  /** その日に «このユーザーが» 受け取る Pui (プラン倍率適用後) */
  amount: number;
  /** 連続ボーナスが上乗せされる節目の日か */
  isMilestone: boolean;
  /** 'claimed' = 受取済み / 'today' = 今日受け取れる / 'upcoming' = 未来 */
  state: 'claimed' | 'today' | 'upcoming';
};

export type LoginBonusAppInfo = {
  /** サイクルの長さ (既定 7)。アプリはこの数だけマスを描く */
  cycleLength: number;
  /** 1..cycleLength 日目の付与額 (プラン倍率適用後) */
  schedule: number[];
  /** 今日受け取ると貰える額 (受取済みなら «次に» 貰える額) */
  nextAmount: number;
  /** サイクル内の現在位置 (1..cycleLength) */
  cyclePosition: number;
  /** スタンプカード表示用の詳細 */
  days: LoginBonusScheduleDay[];
  /** 適用されているプラン倍率 (例: 2 なら 2 倍) */
  planMultiplier: number;
};

/**
 * ログインボーナスのスケジュール情報を組み立てる。
 *
 * @param params.streak       連続ログイン日数。
 *                            受取済みなら «今日を含む» 値、未受取なら現在の連続日数。
 * @param params.claimedToday 今日受け取ったか
 * @param params.plan         ユーザーのプラン (金額に倍率がかかる)
 * @param params.rates        サーバーの Pui レート設定
 */
export function buildLoginBonusAppInfo(params: {
  streak: number;
  claimedToday: boolean;
  plan: PlanTypeLiteral;
  rates: PuiRateSettings;
}): LoginBonusAppInfo {
  const { streak, claimedToday, plan, rates } = params;

  /**
   * カレンダーの位置計算は既に Web 版で使っている
   * buildLoginBonusCalendar に任せる (2 箇所で別々に計算するとズレる)。
   *
   * 未受取のときは «今日受け取れば到達する日数» を渡す必要がある。
   * buildLoginBonusCalendar は Math.max(1, streak) で扱うため、
   * 未受取 streak=0 → 1 日目、未受取 streak=3 → 4 日目が今日、となるよう
   * 未受取時は +1 した値を渡す。
   */
  const streakForCalendar = claimedToday ? streak : streak + 1;
  const calendar = buildLoginBonusCalendar(streakForCalendar, claimedToday, rates);

  // プラン倍率を適用して «実際に受け取る額» にする
  const days: LoginBonusScheduleDay[] = calendar.map((d) => ({
    day: d.day,
    amount: applyPlanPuiMultiplier(d.amount, plan),
    isMilestone: d.isMilestone,
    state: d.state,
  }));

  const cycleLength = days.length;
  const schedule = days.map((d) => d.amount);

  /**
   * 今日受け取れる額。
   * 受取済みの場合は «次にログインしたとき» の額を返す
   * (アプリで「明日は 60 Pui!」と出せるようにする)。
   */
  const todayIndex = days.findIndex((d) => d.state === 'today');
  let nextAmount: number;
  let cyclePosition: number;
  if (todayIndex >= 0) {
    nextAmount = days[todayIndex]!.amount;
    cyclePosition = days[todayIndex]!.day;
  } else {
    // 受取済み → 次の日 (サイクルを超えたら 1 日目に戻る)
    const claimedCount = days.filter((d) => d.state === 'claimed').length;
    cyclePosition = claimedCount === 0 ? 1 : claimedCount;
    const nextIdx = claimedCount % cycleLength; // 7 日目まで受取済みなら 1 日目へ
    nextAmount = days[nextIdx]!.amount;
  }

  return {
    cycleLength,
    schedule,
    nextAmount,
    cyclePosition,
    days,
    planMultiplier: applyPlanPuiMultiplier(100, plan) / 100,
  };
}
