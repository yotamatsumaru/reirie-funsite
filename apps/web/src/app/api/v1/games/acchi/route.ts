/**
 * あっち向いてホイ ミニゲーム API (v1 / クライアント非依存)
 *
 * GET  /api/v1/games/acchi  — 本日の残りプレイ回数 & 残高
 * POST /api/v1/games/acchi  — 1 プレイ実行 (手と方向を送信、結果はサーバーが確定)
 *
 * 認証: Bearer トークン (Unity 等) または Cookie セッション (Web) のどちらでも可。
 *       → Web 版と Unity 版が「同じエンドポイント・同じロジック」を共有できる。
 *
 * セキュリティは Web 版 (/api/me/games/acchi) と同一:
 *  - CPU の手 / 方向 / 勝敗はサーバーで生成・確定 (クライアントの結果は信用しない)。
 *  - 回数上限・ポイント付与はトランザクション内で原子的に処理。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import {
  jstDateKey,
  remainingPlays,
  isJankenHand,
  isAcchiDirection,
  ACCHI_MAX_PLAYS_PER_DAY,
  ACCHI_WIN_REWARD,
  EXTRA_PLAY_COST_FAN_POINTS,
  MAX_EXTRA_PLAYS_PER_DAY,
  resolveAcchiSettingForPlan,
  type PlanTypeLiteral,
} from '@idol/shared';
import { handle, errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { requireApiPrincipal } from '@/lib/api-auth';
import {
  getAcchiPlayCountToday,
  getAcchiExtraPlaysToday,
  getAcchiRewardBonusGrantedToday,
  recordAcchiPlay,
} from '@/lib/points';
import { resolveAcchiPlay } from '@/lib/games/acchi';
import { getAcchiWinSettings, getAcchiRewardBonusSettings } from '@/lib/app-setting';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * ユーザーの現在プランを解決する。
 *  - demoMode はアカウントを PREMIUM 固定で扱う。
 *  - それ以外は有効サブスクリプションの planType (なければ FREE)。
 */
async function resolveUserPlan(userId: string): Promise<PlanTypeLiteral> {
  if (env.demoMode) return 'PREMIUM';
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
    orderBy: { createdAt: 'desc' },
    select: { planType: true },
  });
  return (sub?.planType as PlanTypeLiteral | undefined) ?? 'FREE';
}

export const GET = handle(async (req: Request) => {
  const principal = await requireApiPrincipal(req);

  const [playedToday, purchasedExtra, user, rewardBonusSettings, rewardPointGrantedToday] =
    await Promise.all([
      getAcchiPlayCountToday(principal.userId),
      env.demoMode ? Promise.resolve(0) : getAcchiExtraPlaysToday(principal.userId),
      env.demoMode
        ? Promise.resolve(null)
        : prisma.user.findUnique({
            where: { id: principal.userId },
            select: { points: true, rewardPoints: true },
          }),
      getAcchiRewardBonusSettings(),
      env.demoMode ? Promise.resolve(0) : getAcchiRewardBonusGrantedToday(principal.userId),
    ]);

  const maxPerDay = ACCHI_MAX_PLAYS_PER_DAY + purchasedExtra;
  return NextResponse.json({
    date: jstDateKey(),
    baseMaxPerDay: ACCHI_MAX_PLAYS_PER_DAY,
    maxPerDay,
    winReward: ACCHI_WIN_REWARD,
    playedToday,
    remaining: remainingPlays(playedToday, maxPerDay),
    balance: user?.points ?? 0,
    extraPlay: {
      purchasedToday: purchasedExtra,
      maxPurchasesPerDay: MAX_EXTRA_PLAYS_PER_DAY,
      costFanPoints: EXTRA_PLAY_COST_FAN_POINTS,
      canBuyMore: purchasedExtra < MAX_EXTRA_PLAYS_PER_DAY,
    },
    rewardPointBonus: {
      perWin: rewardBonusSettings.perWin,
      dailyCap: rewardBonusSettings.dailyCap,
      grantedToday: rewardPointGrantedToday,
      balance: user?.rewardPoints ?? 0,
    },
  });
});

export const POST = handle(async (req: Request) => {
  const principal = await requireApiPrincipal(req);

  const body = (await req.json().catch(() => null)) as
    | { hand?: unknown; direction?: unknown }
    | null;
  if (!body || !isJankenHand(body.hand) || !isAcchiDirection(body.direction)) {
    throw errors.badRequest('手と方向を正しく指定してください');
  }

  // プラン → 設定 (1〜6) → 勝率 を解決し、サーバー側で勝敗を確定する
  const [plan, winSettings, rewardBonusSettings] = await Promise.all([
    resolveUserPlan(principal.userId),
    getAcchiWinSettings(),
    getAcchiRewardBonusSettings(),
  ]);
  const setting = resolveAcchiSettingForPlan(winSettings, plan);

  const play = resolveAcchiPlay(body.hand, body.direction, setting);
  const detail = JSON.stringify({
    jankenPlayer: play.jankenPlayer,
    jankenCpu: play.jankenCpu,
    jankenOutcome: play.jankenOutcome,
    playerDirection: play.playerDirection,
    cpuDirection: play.cpuDirection,
    plan,
    setting,
  });

  const persisted = await recordAcchiPlay(
    principal.userId,
    play.result,
    detail,
    undefined,
    rewardBonusSettings,
  );

  if (!persisted.accepted) {
    throw errors.rateLimited('本日のプレイ回数の上限に達しました。明日また挑戦してください');
  }

  if (persisted.reward > 0 || persisted.rewardPointBonus > 0) {
    await logAudit({
      userId: principal.userId,
      action: 'points.game_reward',
      resource: `user:${principal.userId}`,
      metadata: {
        game: 'ACCHI_MUITE_HOI',
        amount: persisted.reward,
        rewardPointBonus: persisted.rewardPointBonus,
        result: persisted.result,
        via: principal.source,
        plan,
        setting,
      },
    });
  }

  return NextResponse.json({
    janken: {
      player: play.jankenPlayer,
      cpu: play.jankenCpu,
      outcome: play.jankenOutcome,
    },
    direction: {
      player: play.playerDirection,
      cpu: play.cpuDirection,
    },
    result: persisted.result,
    reward: persisted.reward,
    balance: persisted.balance,
    playedToday: persisted.playedToday,
    remaining: persisted.remaining,
    maxPerDay: persisted.maxPerDay,
    rewardPointBonus: persisted.rewardPointBonus,
    rewardPointBalance: persisted.rewardPointBalance,
    rewardPointGrantedToday: persisted.rewardPointGrantedToday,
    rewardPointDailyCap: persisted.rewardPointDailyCap,
    sequence: play.sequence,
  });
});
