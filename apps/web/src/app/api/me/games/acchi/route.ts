/**
 * あっち向いてホイ ミニゲーム API
 *
 * GET  /api/me/games/acchi  — 本日の残りプレイ回数 & 残高を取得
 * POST /api/me/games/acchi  — 1 プレイを実行 (じゃんけん + 方向を送信、結果はサーバーが確定)
 *
 * セキュリティ:
 *  - CPU の手 / 方向 / 勝敗はすべてサーバーで生成・確定 (クライアントの結果は信用しない)。
 *  - 勝率は「プレイヤーのプランに割り当てられた設定 (1〜6)」でサーバーが制御する。
 *    プランは JWT ではなく DB の有効サブスクリプションから都度解決する (改ざん不可)。
 *  - 1 日の回数上限・ポイント付与はトランザクション内で原子的に処理 (cluster でも安全)。
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
import { requireApiSession } from '@/lib/api-auth';
import { handle, errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import {
  getAcchiPlayCountToday,
  getAcchiExtraPlaysToday,
  getAcchiRewardBonusGrantedToday,
  recordAcchiPlay,
} from '@/lib/points';
import { resolveAcchiPlay } from '@/lib/games/acchi';
import { getAcchiWinSettings, getAcchiRewardBonusSettings } from '@/lib/app-setting';

export const runtime = 'nodejs';

/**
 * ユーザーの現在プランを DB の有効サブスクリプションから解決する。
 * (JWT の plan はキャッシュで古い場合があるため、勝率計算はサーバーで再解決)
 */
async function resolveUserPlan(userId: string): Promise<PlanTypeLiteral> {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
    orderBy: { createdAt: 'desc' },
    select: { planType: true },
  });
  return (sub?.planType as PlanTypeLiteral | undefined) ?? 'FREE';
}

export const GET = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const [playedToday, purchasedExtra, user, rewardBonusSettings, rewardPointGrantedToday] =
    await Promise.all([
      getAcchiPlayCountToday(session.user.id),
      getAcchiExtraPlaysToday(session.user.id),
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: { points: true, rewardPoints: true },
      }),
      getAcchiRewardBonusSettings(),
      getAcchiRewardBonusGrantedToday(session.user.id),
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
  const session = await requireApiSession(req);

  const body = (await req.json().catch(() => null)) as
    | { hand?: unknown; direction?: unknown }
    | null;
  if (!body || !isJankenHand(body.hand) || !isAcchiDirection(body.direction)) {
    throw errors.badRequest('手と方向を正しく指定してください');
  }

  // プラン → 設定 (1〜6) → 勝率 を解決し、サーバー側で勝敗を確定する
  const [plan, winSettings, rewardBonusSettings] = await Promise.all([
    resolveUserPlan(session.user.id),
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
    session.user.id,
    play.result,
    detail,
    undefined,
    rewardBonusSettings,
  );

  if (!persisted.accepted) {
    // 本日の上限に達している
    throw errors.rateLimited('本日のプレイ回数の上限に達しました。明日また挑戦してください');
  }

  if (persisted.reward > 0 || persisted.rewardPointBonus > 0) {
    await logAudit({
      userId: session.user.id,
      action: 'points.game_reward',
      resource: `user:${session.user.id}`,
      metadata: {
        game: 'ACCHI_MUITE_HOI',
        amount: persisted.reward,
        rewardPointBonus: persisted.rewardPointBonus,
        result: persisted.result,
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
    // 演出用シーケンス (やり直しを含む決着までの流れ)
    sequence: play.sequence,
  });
});
