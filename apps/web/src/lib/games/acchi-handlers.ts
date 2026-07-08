/**
 * あっち向いてホイ ミニゲーム API の共通ハンドラ実装。
 *
 * `/api/me/games/acchi` (Web) と `/api/v1/games/acchi` (Unity 等ネイティブクライアント向け
 * バージョン付き API) は同一のゲームロジック・DB アクセスを必要とするため、
 * ロジックの二重実装を避けてここに集約する。
 *
 * 2 つの URL が存在する理由 (URL 自体は統合しない):
 *  - `/api/me/games/acchi` … 既存の Web フロントエンド (`acchi-client.tsx`) が呼ぶ URL。
 *  - `/api/v1/games/acchi` … Unity 移行を見据えて先に追加されたバージョン付き URL。
 *    既にこの URL で統合済みのネイティブクライアントがある可能性があるため、
 *    URL 自体は後方互換のため維持し、ロジックだけをここに一本化する。
 *
 * 認証は `requireApiPrincipal` (Bearer / Cookie 両対応) で統一し、
 * 監査ログの `via` (認証方式) も両エンドポイントで一貫して記録する。
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
import { errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { requireApiPrincipal, type ApiPrincipal } from '@/lib/api-auth';
import {
  getAcchiPlayCountToday,
  getAcchiExtraPlaysToday,
  getAcchiRewardBonusGrantedToday,
  recordAcchiPlay,
  buyAcchiExtraPlay,
} from '@/lib/points';
import { resolveAcchiPlay } from '@/lib/games/acchi';
import { getAcchiWinSettings, getAcchiRewardBonusSettings } from '@/lib/app-setting';

/**
 * ユーザーの現在プランを DB の有効サブスクリプションから解決する。
 * (JWT の plan はキャッシュで古い場合があるため、勝率計算はサーバーで再解決)
 *
 * ※ 以前は DEMO_MODE 時に `/api/v1` 側だけ PREMIUM 固定 + DB 参照スキップの
 *   特別扱いをしていたが、これは `packages/db/src/demo-prisma.ts` の
 *   複合ユニークキー (`userId_gameType_date`) 未対応バグの回避策だった。
 *   当該バグを修正したため、DEMO_MODE でも通常どおり DB (デモスタブ) を
 *   参照する経路に統一する。
 */
async function resolveUserPlan(userId: string): Promise<PlanTypeLiteral> {
  const sub = await prisma.subscription.findFirst({
    where: { userId, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
    orderBy: { createdAt: 'desc' },
    select: { planType: true },
  });
  return (sub?.planType as PlanTypeLiteral | undefined) ?? 'FREE';
}

export async function handleAcchiGet(req: Request): Promise<Response> {
  const principal = await requireApiPrincipal(req);

  const [playedToday, purchasedExtra, user, rewardBonusSettings, rewardPointGrantedToday] =
    await Promise.all([
      getAcchiPlayCountToday(principal.userId),
      getAcchiExtraPlaysToday(principal.userId),
      prisma.user.findUnique({
        where: { id: principal.userId },
        select: { points: true, rewardPoints: true },
      }),
      getAcchiRewardBonusSettings(),
      getAcchiRewardBonusGrantedToday(principal.userId),
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
}

export async function handleAcchiPost(req: Request): Promise<Response> {
  const principal: ApiPrincipal = await requireApiPrincipal(req);

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
    // 本日の上限に達している
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
    // 演出用シーケンス (やり直しを含む決着までの流れ)
    sequence: play.sequence,
  });
}

/**
 * POST /api/{me,v1}/games/acchi/buy-extra-play の共通実装。
 *  - あっち向いてホイの本日の追加プレイ回数を Fan ポイントで購入する
 *  - 1 日に購入できる追加回数には上限がある (MAX_EXTRA_PLAYS_PER_DAY)
 *  - Fan ポイント残高不足時は 422 (POINT_INTEGRITY) を返す
 */
export async function handleAcchiBuyExtraPlay(req: Request): Promise<Response> {
  const principal = await requireApiPrincipal(req);
  const result = await buyAcchiExtraPlay(principal.userId);

  if (!result.ok) {
    throw errors.rateLimited(
      `本日の追加プレイ購入は上限 (${MAX_EXTRA_PLAYS_PER_DAY}回) に達しています`,
    );
  }

  await logAudit({
    userId: principal.userId,
    action: 'points.extra_play_purchase',
    resource: `user:${principal.userId}`,
    metadata: {
      game: 'ACCHI_MUITE_HOI',
      cost: EXTRA_PLAY_COST_FAN_POINTS,
      purchasedToday: result.purchasedToday,
      via: principal.source,
    },
  });

  return NextResponse.json({
    balance: result.balance,
    purchasedToday: result.purchasedToday,
    maxPerDay: result.maxPerDay,
    cost: EXTRA_PLAY_COST_FAN_POINTS,
  });
}
