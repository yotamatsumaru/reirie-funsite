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
  isAcchiDirection,
  ACCHI_MAX_PLAYS_PER_DAY,
  ACCHI_WIN_REWARD,
  EXTRA_PLAY_COST_PUI,
  MAX_EXTRA_PLAYS_PER_DAY,
  resolveAcchiSettingForPlan,
  isPromoActive,
  PROMO_EFFECTIVE_PLAN,
  type PlanTypeLiteral,
} from '@idol/shared';
import { errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { requireApiPrincipal, type ApiPrincipal } from '@/lib/api-auth';
import {
  getAcchiPlayCountToday,
  getAcchiExtraPlaysToday,
  recordAcchiPlay,
  buyAcchiExtraPlay,
  PROMO_UNLIMITED_REMAINING,
  safeGetPromoUntil,
} from '@/lib/points';
import { resolveAcchiPlay } from '@/lib/games/acchi';
import { getAcchiWinSettings } from '@/lib/app-setting';
import { requireGameSectionVisible } from '@/lib/game-visibility';

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
  // プロモ/デモアカウントは勝率を PREMIUM 相当に固定する
  // (リリースイベントの配信で「よく勝つ」デモができるように)。
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

export async function handleAcchiGet(req: Request): Promise<Response> {
  // ゲーム非公開中は API も 404 (管理者は動作確認のため引き続き利用可)。
  // ページだけ隠しても API が生きていると直接叩いてプレイできてしまうため、
  // ポイントが動く POST 系だけでなく GET も塞ぐ。
  await requireGameSectionVisible(req);
  const principal = await requireApiPrincipal(req);

  const [playedToday, purchasedExtra, user, promoUntil] = await Promise.all([
    getAcchiPlayCountToday(principal.userId),
    getAcchiExtraPlaysToday(principal.userId),
    prisma.user.findUnique({
      where: { id: principal.userId },
      select: { pui: true },
    }),
    // promo_until はカラム未追加でも 500 にしないよう安全に読む (未追加なら null)。
    safeGetPromoUntil(prisma, principal.userId),
  ]);

  // プロモ/デモアカウントは回数無制限。remaining は大きな値を返し、
  // promoActive フラグを立てて UI 側で「∞」表示にする。
  const promoActive = isPromoActive(promoUntil);
  const maxPerDay = ACCHI_MAX_PLAYS_PER_DAY + purchasedExtra;
  return NextResponse.json({
    date: jstDateKey(),
    promoActive,
    baseMaxPerDay: ACCHI_MAX_PLAYS_PER_DAY,
    maxPerDay,
    winReward: ACCHI_WIN_REWARD,
    playedToday,
    remaining: promoActive
      ? PROMO_UNLIMITED_REMAINING
      : remainingPlays(playedToday, maxPerDay),
    balance: user?.pui ?? 0,
    extraPlay: {
      purchasedToday: purchasedExtra,
      maxPurchasesPerDay: MAX_EXTRA_PLAYS_PER_DAY,
      costPui: EXTRA_PLAY_COST_PUI,
      canBuyMore: purchasedExtra < MAX_EXTRA_PLAYS_PER_DAY,
    },
  });
}

/**
 * POST /api/{me,v1}/games/acchi — 1 プレイを実行する (方向対決 1 ラウンドのみ)。
 *
 * クライアントは「方向」だけを送る。サーバーはプラン → 設定 (1〜6) → 勝率を
 * 解決し、方向対決の勝敗を確定・記録する。
 */
export async function handleAcchiPost(req: Request): Promise<Response> {
  // 非公開中はプレイ不可 (= ポイントも動かない)。管理者のみ動作確認できる。
  await requireGameSectionVisible(req);
  const principal: ApiPrincipal = await requireApiPrincipal(req);

  const body = (await req.json().catch(() => null)) as { direction?: unknown } | null;
  if (!body || !isAcchiDirection(body.direction)) {
    throw errors.badRequest('方向を正しく指定してください');
  }

  // プラン → 設定 (1〜6) → 勝率 を解決し、サーバー側で勝敗を確定する
  const [plan, winSettings] = await Promise.all([
    resolveUserPlan(principal.userId),
    getAcchiWinSettings(),
  ]);
  const setting = resolveAcchiSettingForPlan(winSettings, plan);

  const play = resolveAcchiPlay(body.direction, setting);

  const detail = JSON.stringify({
    direction: play.direction,
    plan,
    setting,
  });

  const persisted = await recordAcchiPlay(principal.userId, play.result, detail);

  if (!persisted.accepted) {
    // 本日の上限に達している
    throw errors.rateLimited('本日のプレイ回数の上限に達しました。明日また挑戦してください');
  }

  if (persisted.reward > 0) {
    await logAudit({
      userId: principal.userId,
      action: 'points.game_reward',
      resource: `user:${principal.userId}`,
      metadata: {
        game: 'ACCHI_MUITE_HOI',
        amount: persisted.reward,
        result: persisted.result,
        via: principal.source,
        plan,
        setting,
      },
    });
  }

  return NextResponse.json({
    direction: {
      player: play.direction.player,
      cpu: play.direction.cpu,
      matched: play.direction.matched,
    },
    result: persisted.result,
    reward: persisted.reward,
    balance: persisted.balance,
    playedToday: persisted.playedToday,
    remaining: persisted.remaining,
    maxPerDay: persisted.maxPerDay,
  });
}

/**
 * POST /api/{me,v1}/games/acchi/buy-extra-play の共通実装。
 *  - あっち向いてホイの本日の追加プレイ回数を Pui で購入する
 *  - 1 日に購入できる追加回数には上限がある (MAX_EXTRA_PLAYS_PER_DAY)
 *  - Pui 残高不足時は 422 (PUI_INTEGRITY) を返す
 */
export async function handleAcchiBuyExtraPlay(req: Request): Promise<Response> {
  // 【重要】非公開中に Pui を消費させないための最優先ガード。
  // 遊べないゲームの追加プレイ権を買わせてしまうと返金対応が発生するため、
  // 課金処理より必ず前に 404 で止める。
  await requireGameSectionVisible(req);
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
