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
  PROMO_UNLIMITED_REMAINING,
} from '@/lib/points';
import {
  resolveAcchiPlay,
  resolveAcchiRound1,
  rollRound2Matched,
  buildRound2,
} from '@/lib/games/acchi';
import { getAcchiWinSettings, getAcchiRewardBonusSettings } from '@/lib/app-setting';
import {
  signAcchiRound2Token,
  verifyAcchiRound2Token,
} from '@/lib/games/acchi-token';
import {
  decideAcchiRound1,
  judgeAcchiRound2,
  clampAcchiWinSetting,
  isPromoActive,
  PROMO_EFFECTIVE_PLAN,
} from '@idol/shared';

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
  const [user, sub] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { promoUntil: true } }),
    prisma.subscription.findFirst({
      where: { userId, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
      orderBy: { createdAt: 'desc' },
      select: { planType: true },
    }),
  ]);
  if (isPromoActive(user?.promoUntil ?? null)) return PROMO_EFFECTIVE_PLAN;
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
        select: { points: true, rewardPoints: true, promoUntil: true },
      }),
      getAcchiRewardBonusSettings(),
      getAcchiRewardBonusGrantedToday(principal.userId),
    ]);

  // プロモ/デモアカウントは回数無制限。remaining は大きな値を返し、
  // promoActive フラグを立てて UI 側で「∞」表示にする。
  const promoActive = isPromoActive(user?.promoUntil ?? null);
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
    round1: play.round1,
    round2: play.round2,
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
    // 後方互換用 (旧クライアント/Unity 向け): ラウンド1の "決着した" 試行を
    // 従来と同じ shape で返す。ラウンド1で負けた場合、ラウンド2は行われないため
    // direction.cpu は null になる (従来は必ず値が入っていた点が変更点)。
    janken: {
      player: play.round1.decisive.player,
      cpu: play.round1.decisive.cpu,
      outcome: play.round1.decisive.outcome,
    },
    direction: {
      player: play.round2?.player ?? body.direction,
      cpu: play.round2?.cpu ?? null,
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
    // 2ラウンド制の詳細情報 (新クライアント用)。
    //  - round1.attempts: あいこによるやり直しを含む全試行
    //  - round1.result: 'GAME_OVER' (負けて終了) | 'ADVANCE_TO_ROUND2' (勝って進んだ)
    //  - round2: ラウンド1で負けた場合は null (ラウンド2は行われない)
    round1: {
      attempts: play.round1.attempts,
      result: play.round2 ? 'ADVANCE_TO_ROUND2' : 'GAME_OVER',
    },
    round2: play.round2
      ? {
          player: play.round2.player,
          cpu: play.round2.cpu,
          matched: play.round2.matched,
        }
      : null,
  });
}

/**
 * プラン → 勝率設定 (1〜6) → 特典ボーナス設定 をまとめて解決する共通ヘルパ。
 * (じゃんけん確定・方向対決の両フェーズで使う)
 */
async function resolveAcchiContext(userId: string) {
  const [plan, winSettings, rewardBonusSettings] = await Promise.all([
    resolveUserPlan(userId),
    getAcchiWinSettings(),
    getAcchiRewardBonusSettings(),
  ]);
  const setting = resolveAcchiSettingForPlan(winSettings, plan);
  return { plan, setting, rewardBonusSettings };
}

/**
 * POST /api/me/games/acchi/janken (2段階フロー・フェーズ1: じゃんけん)。
 *
 * クライアントは「手」だけを送る。サーバーは:
 *  1. じゃんけん (あいこのやり直しを含む) を確定する。
 *  2. 【仕様: フェーズ1でプレイ回数を 1 消費】勝敗を最終確定して記録する。
 *     - じゃんけんで負け → 最終結果 LOSE として記録 (方向対決なし)。
 *     - じゃんけんで勝ち → 方向対決の勝敗 (matched) をここで先に抽選し、
 *       その最終結果 (WIN/LOSE) を記録する。方向対決の「見た目」は
 *       フェーズ2でプレイヤーが指した方向に合わせて構成する。
 *  3. 勝った場合は、確定済みの matched を封じた署名付き進行トークンを返す。
 *     クライアントはフェーズ2でこのトークンを送り、方向対決の演出だけを行う。
 *
 * これにより「じゃんけんの結果が出る前に方向(指)を選ばされる」バグを解消し、
 * 実際のあっちむいてホイと同じ「勝ってから指す」順序にする。
 */
export async function handleAcchiJanken(req: Request): Promise<Response> {
  const principal: ApiPrincipal = await requireApiPrincipal(req);

  const body = (await req.json().catch(() => null)) as { hand?: unknown } | null;
  if (!body || !isJankenHand(body.hand)) {
    throw errors.badRequest('手を正しく指定してください');
  }

  const { plan, setting, rewardBonusSettings } = await resolveAcchiContext(
    principal.userId,
  );

  // ラウンド1 (じゃんけん) を決着まで解決する (あいこは内部でやり直し)。
  const round1 = resolveAcchiRound1(body.hand);
  const advancing = decideAcchiRound1(round1.decisive.outcome) === 'ADVANCE_TO_ROUND2';

  // 勝った場合は方向対決の勝敗をここで先に抽選し、最終結果を確定する。
  // (フェーズ1でプレイ回数を消費する仕様のため、結果もここで確定させる)
  const matched = advancing ? rollRound2Matched(setting) : false;
  const finalResult = advancing ? judgeAcchiRound2(matched) : 'LOSE';

  const detail = JSON.stringify({
    phase: 'janken',
    round1,
    advancing,
    matched: advancing ? matched : null,
    plan,
    setting,
  });

  const persisted = await recordAcchiPlay(
    principal.userId,
    finalResult,
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
        flow: 'two-phase',
      },
    });
  }

  // 勝った場合のみ、方向対決 (フェーズ2) 用の進行トークンを発行する。
  const round2Token = advancing
    ? await signAcchiRound2Token({
        userId: principal.userId,
        playId: persisted.playId ?? '',
        matched,
        hand: round1.decisive.player,
        cpuHand: round1.decisive.cpu,
        setting,
      })
    : null;

  return NextResponse.json({
    // ラウンド1 の全試行 (あいこのやり直しを含む) — クライアントの演出用。
    round1: {
      attempts: round1.attempts,
      result: advancing ? 'ADVANCE_TO_ROUND2' : 'GAME_OVER',
    },
    janken: {
      player: round1.decisive.player,
      cpu: round1.decisive.cpu,
      outcome: round1.decisive.outcome,
    },
    // 勝った場合: フェーズ2 で方向を送るためのトークン。負けた場合: null (即結果)。
    round2Token,
    // 負けた場合はここで結果が確定する (方向対決に進まない)。
    // 勝った場合は「まだ結果を返さない」= フェーズ2の方向選択を待つ。
    finished: !advancing,
    // プロモ/デモアカウント (回数無制限) か。UI の残り回数表示に使う。
    promoActive: persisted.promoActive,
    // 負け確定時の残高・回数情報 (勝ち時はフェーズ2完了時にクライアントが既知)。
    reward: persisted.reward,
    balance: persisted.balance,
    playedToday: persisted.playedToday,
    remaining: persisted.remaining,
    maxPerDay: persisted.maxPerDay,
    rewardPointBonus: persisted.rewardPointBonus,
    rewardPointBalance: persisted.rewardPointBalance,
    rewardPointGrantedToday: persisted.rewardPointGrantedToday,
    rewardPointDailyCap: persisted.rewardPointDailyCap,
    // 勝ち時は最終結果、負け時は 'LOSE'。
    result: persisted.result,
  });
}

/**
 * POST /api/me/games/acchi/direction (2段階フロー・フェーズ2: 方向対決)。
 *
 * クライアントは「フェーズ1で得た進行トークン」+「指す方向」を送る。
 * 勝敗はフェーズ1で確定済み (トークン内の matched) なので、ここでは
 * その matched に整合する CPU の方向を構成して返すだけ (再抽選しない)。
 *
 * ※ プレイ回数の消費・ポイント付与はフェーズ1で完了済み。
 *    このエンドポイントは DB を変更しない (演出のための整合データを返すのみ)。
 */
export async function handleAcchiDirection(req: Request): Promise<Response> {
  const principal: ApiPrincipal = await requireApiPrincipal(req);

  const body = (await req.json().catch(() => null)) as
    | { token?: unknown; direction?: unknown }
    | null;
  if (!body || typeof body.token !== 'string' || !isAcchiDirection(body.direction)) {
    throw errors.badRequest('進行トークンと方向を正しく指定してください');
  }

  const claims = await verifyAcchiRound2Token(body.token, principal.userId);
  if (!claims) {
    throw errors.badRequest('進行トークンが無効または期限切れです。もう一度プレイしてください');
  }

  // 勝敗はフェーズ1で確定済み。方向対決の見た目 (CPU の方向) だけを構成する。
  const round2 = buildRound2(
    body.direction,
    claims.matched,
    // setting は buildRound2 の戻り値 (監査用) に含めるだけ。トークン内の数値を安全に丸める。
    clampAcchiWinSetting(claims.setting),
  );

  return NextResponse.json({
    janken: { player: claims.hand, cpu: claims.cpuHand, outcome: 'WIN' as const },
    round2: {
      player: round2.player,
      cpu: round2.cpu,
      matched: round2.matched,
    },
    result: judgeAcchiRound2(claims.matched),
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
