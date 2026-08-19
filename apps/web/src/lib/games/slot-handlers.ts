/**
 * スロット ミニゲーム API の共通ハンドラ実装。
 *
 * `/api/me/games/slot` (Web) と `/api/v1/games/slot` (Unity 等ネイティブクライアント向け
 * バージョン付き API) が同じロジック・DB アクセスを共有するため、
 * あっち向いてホイ (acchi-handlers.ts) と同じ構成でここに集約している。
 *
 * === セキュリティ上の不変条件 ===
 *  - クライアントは「回す」というリクエストしか送らない。役・停止絵柄・配当は
 *    すべてサーバーが暗号論的乱数で確定する (結果や Pui を受け取らない)。
 *  - 出玉率はプレイヤーのプランに割り当てられた設定 (1〜6) でサーバーが制御する。
 *    プランは JWT ではなく DB の有効サブスクリプションから都度解決する (改ざん不可)。
 *  - 1 日の回数上限・Pui 付与はトランザクション + advisory lock で原子的に処理する
 *    (PM2 cluster の並列リクエストでも超過付与が起きない)。
 *  - ゲーム非公開中 (公開/非公開トグル) は 404。ページだけ隠しても API が生きていると
 *    直接叩いてプレイできてしまうため、GET も含めて塞ぐ。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import {
  jstDateKey,
  EXTRA_PLAY_COST_PUI,
  MAX_EXTRA_PLAYS_PER_DAY,
  SLOT_MAX_PLAYS_PER_DAY,
  SLOT_PAYOUT,
  SLOT_MAX_PAYOUT,
  slotRemainingPlays,
  resolveSlotSettingForPlan,
  isPromoActive,
  PROMO_EFFECTIVE_PLAN,
  type PlanTypeLiteral,
} from '@idol/shared';
import { errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { requireApiPrincipal, type ApiPrincipal } from '@/lib/api-auth';
import {
  getSlotPlayCountToday,
  getSlotExtraPlaysToday,
  recordSlotPlay,
  buySlotExtraPlay,
  PROMO_UNLIMITED_REMAINING,
  safeGetPromoUntil,
} from '@/lib/points';
import { resolveSlotPlay } from '@/lib/games/slot';
import { getSlotSettings } from '@/lib/app-setting';
import { requireGameSectionVisible } from '@/lib/game-visibility';

/**
 * ユーザーの現在プランを DB の有効サブスクリプションから解決する。
 * (JWT の plan はキャッシュで古い場合があるため、出玉率の計算はサーバーで再解決する)
 *
 * プロモ/デモアカウントは PREMIUM 相当に固定する
 * (リリースイベントの配信で「よく当たる」デモができるように)。
 */
async function resolveUserPlan(userId: string): Promise<PlanTypeLiteral> {
  const [promoUntil, sub] = await Promise.all([
    // promo_until はカラム未追加でも 500 にしないよう安全に読む (未追加なら null)。
    safeGetPromoUntil(prisma, userId),
    prisma.subscription.findFirst({
      where: { userId, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
      orderBy: { createdAt: 'desc' },
      select: { planType: true },
    }),
  ]);
  if (isPromoActive(promoUntil)) return PROMO_EFFECTIVE_PLAN;
  return (sub?.planType as PlanTypeLiteral | undefined) ?? 'FREE';
}

/**
 * GET /api/{me,v1}/games/slot — 本日の残りプレイ回数・残高・配当表を取得する。
 *
 * 配当表 (payouts) をサーバーから返すのは、クライアントに配当をハードコードさせず、
 * 将来配当を変更したときに UI が自動追従するようにするため。
 */
export async function handleSlotGet(req: Request): Promise<Response> {
  await requireGameSectionVisible(req);
  const principal = await requireApiPrincipal(req);

  const [playedToday, purchasedExtra, user, promoUntil] = await Promise.all([
    getSlotPlayCountToday(principal.userId),
    getSlotExtraPlaysToday(principal.userId),
    prisma.user.findUnique({
      where: { id: principal.userId },
      select: { pui: true },
    }),
    safeGetPromoUntil(prisma, principal.userId),
  ]);

  // プロモ/デモアカウントは回数無制限。remaining は大きな値を返し、
  // promoActive フラグを立てて UI 側で「∞」表示にする。
  const promoActive = isPromoActive(promoUntil);
  const maxPerDay = SLOT_MAX_PLAYS_PER_DAY + purchasedExtra;

  return NextResponse.json({
    date: jstDateKey(),
    promoActive,
    baseMaxPerDay: SLOT_MAX_PLAYS_PER_DAY,
    maxPerDay,
    playedToday,
    remaining: promoActive
      ? PROMO_UNLIMITED_REMAINING
      : slotRemainingPlays(playedToday, maxPerDay),
    balance: user?.pui ?? 0,
    maxPayout: SLOT_MAX_PAYOUT,
    // 役 → ベース配当 (プラン倍率適用前)。UI の配当表に使う。
    payouts: SLOT_PAYOUT,
    extraPlay: {
      purchasedToday: purchasedExtra,
      maxPurchasesPerDay: MAX_EXTRA_PLAYS_PER_DAY,
      costPui: EXTRA_PLAY_COST_PUI,
      canBuyMore: purchasedExtra < MAX_EXTRA_PLAYS_PER_DAY,
    },
  });
}

/**
 * POST /api/{me,v1}/games/slot — 1 プレイ (1 回転) を実行する。
 *
 * リクエストボディは不要 (クライアントからの入力は一切結果に影響しない)。
 */
export async function handleSlotPost(req: Request): Promise<Response> {
  // 非公開中はプレイ不可 (= Pui も動かない)。管理者のみ動作確認できる。
  await requireGameSectionVisible(req);
  const principal: ApiPrincipal = await requireApiPrincipal(req);

  // プラン → 設定 (1〜6) → 確率テーブル を解決し、サーバー側で役を確定する。
  const [plan, settings] = await Promise.all([
    resolveUserPlan(principal.userId),
    getSlotSettings(),
  ]);
  const setting = resolveSlotSettingForPlan(settings, plan);

  const play = resolveSlotPlay(setting);

  const detail = JSON.stringify({
    outcome: play.outcome,
    reels: play.reels,
    basePayout: play.payout,
    plan,
    setting,
  });

  // ベース配当を渡す。プラン倍率は recordSlotPlay の中で掛かる (二重適用しない)。
  const persisted = await recordSlotPlay(
    principal.userId,
    play.outcome,
    play.payout,
    detail,
  );

  if (!persisted.accepted) {
    throw errors.rateLimited(
      '本日のプレイ回数の上限に達しました。明日また挑戦してください',
    );
  }

  if (persisted.reward > 0) {
    await logAudit({
      userId: principal.userId,
      action: 'points.game_reward',
      resource: `user:${principal.userId}`,
      metadata: {
        game: 'SLOT',
        amount: persisted.reward,
        result: play.outcome,
        via: principal.source,
        plan,
        setting,
      },
    });
  }

  return NextResponse.json({
    reels: play.reels,
    outcome: play.outcome,
    // 実際に付与された Pui (プラン倍率適用後)
    reward: persisted.reward,
    balance: persisted.balance,
    playedToday: persisted.playedToday,
    remaining: persisted.remaining,
    maxPerDay: persisted.maxPerDay,
  });
}

/**
 * POST /api/{me,v1}/games/slot/buy-extra-play — 本日の追加プレイ回数を Pui で購入する。
 */
export async function handleSlotBuyExtraPlay(req: Request): Promise<Response> {
  // 【重要】非公開中に Pui を消費させないための最優先ガード。
  // 遊べないゲームの追加プレイ権を買わせると返金対応が発生するため、
  // 課金処理より必ず前に 404 で止める。
  await requireGameSectionVisible(req);
  const principal = await requireApiPrincipal(req);
  const result = await buySlotExtraPlay(principal.userId);

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
      game: 'SLOT',
      cost: EXTRA_PLAY_COST_PUI,
      purchasedToday: result.purchasedToday,
      via: principal.source,
    },
  });

  return NextResponse.json({
    balance: result.balance,
    purchasedToday: result.purchasedToday,
    maxPerDay: result.maxPerDay,
    cost: EXTRA_PLAY_COST_PUI,
  });
}
