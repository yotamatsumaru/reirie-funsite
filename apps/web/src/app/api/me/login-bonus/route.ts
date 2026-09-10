/**
 * POST /api/me/login-bonus — 毎日のログインボーナスを受け取る
 * GET  /api/me/login-bonus — 今日の受給状況 + 7日スタンプカード情報を取得
 *
 * 二重付与防止: LoginBonusGrant (userId, date[JST]) UNIQUE 制約。
 *
 * 【スマホアプリ対応 (2026-09 追加)】
 * アプリの 7 日スタンプカードで各日の獲得額を表示したいという要望を受け、
 * schedule / nextAmount / days などを追加した。
 *
 * 既存フィールド (date / claimedToday / streak / amount / balance) は
 * そのまま残しているため **Web 版・既存アプリは影響を受けない** (後方互換)。
 *
 * ⚠️ 金額は固定値ではない:
 *   - 管理画面で Pui レート (base / streakBonus / threshold) を変更できる
 *   - プラン倍率 (FREE ×1.0 / STANDARD ×1.2 / PREMIUM ×2.0) がかかる
 * そのため «そのユーザーが実際に受け取る額» をサーバーで算出して返す。
 * アプリ側で固定値を持つと、表示と実際の付与額がズレる。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import {
  buildLoginBonusAppInfo,
  jstDateKey,
  previousJstDateKey,
  type PlanTypeLiteral,
} from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { getPuiRates } from '@/lib/app-setting';
import { grantLoginBonus } from '@/lib/points';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const today = jstDateKey();
  const [grant, user, rates] = await Promise.all([
    prisma.loginBonusGrant.findUnique({
      where: { userId_date: { userId: session.user.id, date: today } },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { pui: true },
    }),
    getPuiRates(),
  ]);

  const claimedToday = Boolean(grant);

  /**
   * 未受取のときは «今日時点の連続日数» が必要になる。
   * grant が無い今日については、昨日の grant の streak がそれに当たる。
   * (昨日も受け取っていなければ 0 = 連続が切れている)
   */
  let streak = grant?.streak ?? 0;
  if (!claimedToday) {
    // 日付の引き算は月末・DST を誤りやすいので既存ヘルパを使う
    const yesterday = previousJstDateKey(today);
    const yGrant = await prisma.loginBonusGrant.findUnique({
      where: { userId_date: { userId: session.user.id, date: yesterday } },
      select: { streak: true },
    });
    streak = yGrant?.streak ?? 0;
  }

  const plan = (session.user.plan as PlanTypeLiteral | undefined) ?? 'FREE';
  const info = buildLoginBonusAppInfo({ streak, claimedToday, plan, rates });

  return NextResponse.json(
    {
      // --- 既存フィールド (後方互換のため変更しない) ---
      date: today,
      claimedToday,
      streak: grant?.streak ?? streak,
      amount: grant?.amount ?? 0,
      balance: user?.pui ?? 0,

      // --- スマホアプリ向けに追加 ---
      /** 1〜N 日目の付与額 (プラン倍率適用後) */
      schedule: info.schedule,
      /** 今日受け取れる額 (受取済みなら次回の額) */
      nextAmount: info.nextAmount,
      /** サイクル長 (既定 7)。アプリはこの数だけマスを描く */
      cycleLength: info.cycleLength,
      /** サイクル内の現在位置 (1..cycleLength) */
      cyclePosition: info.cyclePosition,
      /** スタンプカード表示用の詳細 (state で claimed/today/upcoming が分かる) */
      days: info.days,
      /** 適用中のプランと倍率 (アプリで「PREMIUM は 2 倍!」を出せる) */
      plan,
      planMultiplier: info.planMultiplier,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const rates = await getPuiRates();
  const result = await grantLoginBonus(session.user.id, rates);

  if (result.granted) {
    await logAudit({
      userId: session.user.id,
      action: 'points.login_bonus',
      resource: `user:${session.user.id}`,
      metadata: { amount: result.amount, streak: result.streak },
    });
  }

  /**
   * 受け取った直後にスタンプカードを更新できるよう、GET と同じ形の
   * スケジュール情報も返す。
   * (これが無いとアプリは POST 後にもう一度 GET する必要がある)
   */
  const plan = (session.user.plan as PlanTypeLiteral | undefined) ?? 'FREE';
  const info = buildLoginBonusAppInfo({
    streak: result.streak,
    // 付与に成功した場合も、既に付与済みだった場合も «今日は受取済み»
    claimedToday: true,
    plan,
    rates,
  });

  return NextResponse.json(
    {
      // --- 既存フィールド (後方互換) ---
      ...result,

      // --- スマホアプリ向けに追加 ---
      date: jstDateKey(),
      schedule: info.schedule,
      nextAmount: info.nextAmount,
      cycleLength: info.cycleLength,
      cyclePosition: info.cyclePosition,
      days: info.days,
      plan,
      planMultiplier: info.planMultiplier,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
