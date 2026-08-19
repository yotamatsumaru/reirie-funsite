/**
 * Pui (通貨) & 会員番号のサービス層。
 *
 * 【2026-07 通貨名変更】以前は「Fan ポイント」という名称だったが、
 * 通貨名を「Pui」に変更した (User.pui / PuiTransaction / PuiReason)。
 *
 * 設計上の要点 (本番 EC2 + PM2 cluster + RDS でも安全):
 *  - Pui 残高 (User.pui) は PuiTransaction の合計と一致させる。
 *    付与/消費は必ず $transaction で「履歴作成 + 残高インクリメント」を同時実行。
 *  - ログインボーナス / SNS シェアの二重付与は LoginBonusGrant / SocialShareGrant の
 *    ユニーク制約 (P2002) で防ぐ。クラスタ間の競合でも DB が一意性を保証する。
 *  - 会員番号は MemberCounter の単一行を行ロックして連番を払い出す。
 */
import { prisma, Prisma } from '@idol/db';
import {
  formatMemberNumber,
  jstDateKey,
  previousJstDateKey,
  computeLoginBonusAmount,
  isValidPuiAmount,
  MAX_PUI_PER_TX as SHARED_MAX_PUI_PER_TX,
  ACCHI_MAX_PLAYS_PER_DAY,
  ACCHI_WIN_REWARD,
  remainingPlays,
  SLOT_MAX_PLAYS_PER_DAY,
  slotRemainingPlays,
  applyPlanPuiMultiplier,
  MONTHLY_PUI_BONUS,
  EXTRA_PLAY_COST_PUI,
  MAX_EXTRA_PLAYS_PER_DAY,
  requiresShipping,
  canTransitionRedemptionStatus,
  isPromoActive,
  SOCIAL_SHARE_MIN_DWELL_SEC,
  type PuiRateSettings,
  type PlanTypeLiteral,
  type SocialPlatformLiteral,
  type AcchiResult,
  type SlotOutcome,
  type RewardCatalogItemKindLiteral,
  type RewardRedemptionStatusLiteral,
} from '@idol/shared';

/**
 * Pui 取引の理由。
 * 【2026-07 統合】以前は Fan ポイントと特典ポイント (旧 RewardPointReason) の
 * 2 種類の理由 enum があったが、Fan ポイント 1 種類への統合に伴い、
 * Stripe 購入・サブスク月次特典・景品交換・返還の理由もこの型に統合した。
 * 【2026-07 通貨名変更】通貨名を「Fan ポイント」から「Pui」へ変更した。
 */
type PuiReasonLiteral =
  | 'LOGIN_BONUS'
  | 'LOGIN_STREAK'
  | 'SOCIAL_SHARE'
  | 'ADMIN_ADJUST'
  | 'SIGNUP_BONUS'
  | 'GAME_REWARD'
  | 'ITEM_PURCHASE'
  | 'EXTRA_PLAY_PURCHASE'
  | 'STRIPE_PURCHASE'
  | 'SUBSCRIPTION_BONUS'
  | 'REDEMPTION'
  | 'REFUND'
  | 'MERGE_ADJUST'
  | 'OTHER';

/**
 * 1 取引で動かせる Pui の絶対値上限 (防御的上限)。
 * 共有定義 (@idol/shared) を再エクスポートし、サーバ/クライアントで統一する。
 */
export const MAX_PUI_PER_TX = SHARED_MAX_PUI_PER_TX;

/** Pui 整合性に関する業務エラー (不正検知時に throw) */
export class PuiIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PuiIntegrityError';
  }
}

/** Prisma が一意制約違反 (P2002) を投げたか判定 */
function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/**
 * トランザクション内でユーザーの現在プランを取得する。
 *  - プランは「有効なサブスクリプション (ACTIVE / TRIALING / PAST_DUE)」の
 *    planType から判定する (auth.ts のセッション解決と同じロジック)。
 *  - 該当が無ければ 'FREE' (倍率 ×1.0)。
 */
async function getUserPlanTx(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<PlanTypeLiteral> {
  const sub = await tx.subscription.findFirst({
    where: {
      userId,
      status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { planType: true },
  });
  return (sub?.planType as PlanTypeLiteral | undefined) ?? 'FREE';
}

/**
 * 会員番号を採番して付与する (未付与の場合のみ)。
 * 既に付与済みならその番号を返す。
 */
export async function ensureMemberNumber(userId: string): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { memberNumber: true },
  });
  if (existing?.memberNumber) return existing.memberNumber;

  // MemberCounter (id=1) を upsert で確保しつつ next を 1 つ進めて連番を得る。
  // $transaction 内で update することで行ロックがかかり、cluster でも一意。
  const memberNumber = await prisma.$transaction(async (tx) => {
    // カウンター行を保証
    await tx.memberCounter.upsert({
      where: { id: 1 },
      create: { id: 1, next: 1 },
      update: {},
    });
    const counter = await tx.memberCounter.update({
      where: { id: 1 },
      data: { next: { increment: 1 } },
      select: { next: true },
    });
    const seq = counter.next - 1; // increment 後の値の 1 つ前が払い出し番号
    const number = formatMemberNumber(seq);
    await tx.user.update({
      where: { id: userId },
      data: { memberNumber: number },
    });
    return number;
  });

  return memberNumber;
}

/**
 * 会員番号が未採番のユーザー全員に、登録が古い順で会員番号を一括採番する。
 *
 * 会員番号は本来「会員カードを開いた時」または「登録時」に採番されるが、
 * その導線を通っていない既存ユーザーには番号が付いていない。
 * このバックフィルで、番号なしユーザーへ確実に番号を付与する。
 *
 * - 既に番号を持つユーザーは対象外 (番号は変更しない)。
 * - ensureMemberNumber と同じ MemberCounter を使うため連番は継続し重複しない。
 * - 1 件ずつ独立トランザクションで採番するため、途中失敗しても採番済み分は保持される。
 * - 何度実行しても安全 (冪等)。
 *
 * @returns { assigned: 採番した件数, alreadyHad: 既に番号を持っていた件数 }
 */
export async function backfillMemberNumbers(): Promise<{
  assigned: number;
  alreadyHad: number;
}> {
  const [alreadyHad, targets] = await Promise.all([
    prisma.user.count({ where: { memberNumber: { not: null } } }),
    prisma.user.findMany({
      where: { memberNumber: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    }),
  ]);

  let assigned = 0;
  for (const t of targets) {
    // ensureMemberNumber は「未採番なら採番、採番済みならその番号を返す」ため、
    // ここで呼べば重複採番の心配なく安全にバックフィルできる。
    await ensureMemberNumber(t.id);
    assigned += 1;
  }

  return { assigned, alreadyHad };
}

/**
 * Pui を増減し、履歴を残す (内部用)。残高を返す。
 * tx を渡せば既存トランザクションに参加する。
 *
 * セキュリティ上の不変条件:
 *  - amount は整数かつ |amount| <= MAX_POINTS_PER_TX (異常な大量付与をブロック)。
 *  - amount === 0 は無意味なので拒否。
 *  - 残高 (User.pui) は `increment` による原子的更新で、cluster 並列でも壊れない。
 *  - allowNegative=false (既定) のとき、更新後に残高が負になる操作を拒否し、
 *    同一トランザクション内なのでロールバックされる (二重消費・残高不足を防止)。
 *  - PointTransaction.balance には「更新後の実残高」を記録 (監査スナップショット)。
 */
async function applyPui(
  client: Prisma.TransactionClient,
  params: {
    userId: string;
    amount: number;
    reason: PuiReasonLiteral;
    note?: string;
    /** 残高がマイナスになる操作を許可するか (既定 false) */
    allowNegative?: boolean;
  },
): Promise<number> {
  // --- 入力値の防御的検証 (整数 / 非ゼロ / 上限以内) ---
  if (!isValidPuiAmount(params.amount)) {
    if (!Number.isInteger(params.amount)) {
      throw new PuiIntegrityError('Pui は整数で指定してください');
    }
    if (params.amount === 0) {
      throw new PuiIntegrityError('0 Pui の取引は記録できません');
    }
    throw new PuiIntegrityError(
      `1 取引で動かせる Pui は ±${MAX_PUI_PER_TX} までです`,
    );
  }

  // increment は DB 側で原子的に実行され、cluster の並列付与でも競合しない。
  const user = await client.user.update({
    where: { id: params.userId },
    data: { pui: { increment: params.amount } },
    select: { pui: true },
  });

  // 残高がマイナスになる操作は (許可されていない限り) ロールバックさせる。
  if (!params.allowNegative && user.pui < 0) {
    throw new PuiIntegrityError('Pui 残高が不足しています');
  }

  await client.puiTransaction.create({
    data: {
      userId: params.userId,
      amount: params.amount,
      balance: user.pui,
      reason: params.reason,
      note: params.note ?? null,
    },
  });
  return user.pui;
}

export type LoginBonusResult =
  | { granted: true; amount: number; streak: number; balance: number; alreadyGranted: false }
  | { granted: false; alreadyGranted: true; streak: number; balance: number };

/**
 * 毎日のログインボーナスを付与する。
 *  - 同日 (JST) に既に付与済みなら alreadyGranted=true を返す (二重付与防止)。
 *  - 連続ログイン日数 (streak) を前日の付与記録から算出。
 */
export async function grantLoginBonus(
  userId: string,
  rates: PuiRateSettings,
  now: Date = new Date(),
): Promise<LoginBonusResult> {
  const today = jstDateKey(now);

  // 既に今日付与済みか
  const existingToday = await prisma.loginBonusGrant.findUnique({
    where: { userId_date: { userId, date: today } },
  });
  if (existingToday) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { pui: true },
    });
    return {
      granted: false,
      alreadyGranted: true,
      streak: existingToday.streak,
      balance: u?.pui ?? 0,
    };
  }

  const yesterday = previousJstDateKey(today);

  try {
    // streak 算出と付与を 1 トランザクション内で実行し、競合での二重カウントや
    // 不整合を防ぐ (二重付与自体は userId+date のユニーク制約が最終防壁)。
    const { amount, streak, balance } = await prisma.$transaction(async (tx) => {
      const yGrant = await tx.loginBonusGrant.findUnique({
        where: { userId_date: { userId, date: yesterday } },
        select: { streak: true },
      });
      const computedStreak = (yGrant?.streak ?? 0) + 1;
      const baseAmount = computeLoginBonusAmount(computedStreak, rates);
      // プラン別の Pui 付与率を適用 (FREE ×1.0 / STANDARD ×1.2 / PREMIUM ×2.0)
      const plan = await getUserPlanTx(tx, userId);
      const computedAmount = applyPlanPuiMultiplier(baseAmount, plan);

      // ユニーク制約 (userId+date) で二重付与を防止
      await tx.loginBonusGrant.create({
        data: { userId, date: today, streak: computedStreak, amount: computedAmount },
      });
      const bal = await applyPui(tx, {
        userId,
        amount: computedAmount,
        // 連続ボーナス節目かどうかは「倍率適用前」のベース額で判定する
        reason: baseAmount > rates.loginBonusBase ? 'LOGIN_STREAK' : 'LOGIN_BONUS',
      });
      return { amount: computedAmount, streak: computedStreak, balance: bal };
    });
    return { granted: true, amount, streak, balance, alreadyGranted: false };
  } catch (e) {
    // 競合で同時に付与された場合 → 既付与として扱う。
    // 既に作成済みのレコードから正しい streak / 残高を取得して返す。
    if (isUniqueViolation(e)) {
      const [grant, u] = await Promise.all([
        prisma.loginBonusGrant.findUnique({
          where: { userId_date: { userId, date: today } },
          select: { streak: true },
        }),
        prisma.user.findUnique({ where: { id: userId }, select: { pui: true } }),
      ]);
      return {
        granted: false,
        alreadyGranted: true,
        streak: grant?.streak ?? 0,
        balance: u?.pui ?? 0,
      };
    }
    throw e;
  }
}

export type SocialShareResult =
  | { granted: true; amount: number; balance: number; alreadyGranted: false }
  | { granted: false; alreadyGranted: true; balance: number }
  // シェア意図が無い / 待機時間が不足しているため受取を拒否
  | {
      granted: false;
      alreadyGranted: false;
      reason: 'no_intent' | 'too_soon';
      retryAfterSec?: number;
    };

/**
 * SNS シェアの「意図」を記録する (シェアボタンを開いた瞬間に呼ぶ)。
 *  - Pui はまだ付与しない。openedAt を現在時刻に更新 (upsert)。
 *  - 既に当日受取済みなら意図は不要 (no-op) として扱う。
 */
export async function recordSocialShareIntent(
  userId: string,
  platform: SocialPlatformLiteral,
  now: Date = new Date(),
): Promise<{ ok: true; alreadyGranted: boolean; minDwellSec: number }> {
  const today = jstDateKey(now);

  const grant = await prisma.socialShareGrant.findUnique({
    where: { userId_date_platform: { userId, date: today, platform } },
    select: { id: true },
  });
  if (grant) {
    return { ok: true, alreadyGranted: true, minDwellSec: SOCIAL_SHARE_MIN_DWELL_SEC };
  }

  await prisma.socialShareIntent.upsert({
    where: { userId_date_platform: { userId, date: today, platform } },
    create: { userId, date: today, platform, openedAt: now },
    update: { openedAt: now },
  });

  return { ok: true, alreadyGranted: false, minDwellSec: SOCIAL_SHARE_MIN_DWELL_SEC };
}

/**
 * SNS シェアによる Pui 付与。
 *  - 1 プラットフォーム 1 日 1 回まで (userId+date+platform のユニーク制約)。
 *  - 事前に recordSocialShareIntent で当日のシェア意図が記録されており、
 *    かつ意図から SOCIAL_SHARE_MIN_DWELL_SEC 秒以上経過している場合のみ付与する。
 *    これにより「シェアせずに受取だけ押す」不正をサーバー側で防ぐ。
 */
export async function grantSocialShare(
  userId: string,
  platform: SocialPlatformLiteral,
  rates: PuiRateSettings,
  now: Date = new Date(),
): Promise<SocialShareResult> {
  const today = jstDateKey(now);

  const existing = await prisma.socialShareGrant.findUnique({
    where: { userId_date_platform: { userId, date: today, platform } },
  });
  if (existing) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { pui: true },
    });
    return { granted: false, alreadyGranted: true, balance: u?.pui ?? 0 };
  }

  // --- シェア意図の検証: 当日の意図が無ければ拒否 (シェアボタン未使用) ---
  const intent = await prisma.socialShareIntent.findUnique({
    where: { userId_date_platform: { userId, date: today, platform } },
    select: { openedAt: true },
  });
  if (!intent) {
    return { granted: false, alreadyGranted: false, reason: 'no_intent' };
  }

  // 意図から一定時間 (dwell) 経過していなければ拒否 (投稿する時間を確保させる)
  const elapsedSec = Math.floor((now.getTime() - intent.openedAt.getTime()) / 1000);
  if (elapsedSec < SOCIAL_SHARE_MIN_DWELL_SEC) {
    return {
      granted: false,
      alreadyGranted: false,
      reason: 'too_soon',
      retryAfterSec: SOCIAL_SHARE_MIN_DWELL_SEC - elapsedSec,
    };
  }

  try {
    const { amount, balance } = await prisma.$transaction(async (tx) => {
      // プラン別の Pui 付与率を適用 (FREE ×1.0 / STANDARD ×1.2 / PREMIUM ×2.0)
      const plan = await getUserPlanTx(tx, userId);
      const amount = applyPlanPuiMultiplier(rates.socialSharePui, plan);

      await tx.socialShareGrant.create({
        data: { userId, date: today, platform, amount },
      });
      // レートが 0 Pui のときは付与記録のみ残し、Pui 取引はスキップ。
      if (amount <= 0) {
        const u = await tx.user.findUnique({
          where: { id: userId },
          select: { pui: true },
        });
        return { amount, balance: u?.pui ?? 0 };
      }
      const bal = await applyPui(tx, { userId, amount, reason: 'SOCIAL_SHARE' });
      return { amount, balance: bal };
    });
    return { granted: true, amount, balance, alreadyGranted: false };
  } catch (e) {
    if (isUniqueViolation(e)) {
      const u = await prisma.user.findUnique({
        where: { id: userId },
        select: { pui: true },
      });
      return { granted: false, alreadyGranted: true, balance: u?.pui ?? 0 };
    }
    throw e;
  }
}

/**
 * 管理者による Pui 手動調整。amount は正負どちらも可。
 *  - 調整によって残高がマイナスになる場合は PuiIntegrityError を投げ、
 *    トランザクションをロールバックする (残高は常に 0 以上を保証)。
 *  - 監査ログは呼び出し側 (API) で記録する。
 */
export async function adminAdjustPui(
  userId: string,
  amount: number,
  note?: string,
): Promise<number> {
  // 対象ユーザーの存在確認 (存在しない userId で履歴を作らない)
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!target) {
    throw new PuiIntegrityError('対象ユーザーが見つかりません');
  }
  return prisma.$transaction((tx) =>
    applyPui(tx, { userId, amount, reason: 'ADMIN_ADJUST', note }),
  );
}

// ---------------------------------------------------------------------
// Pui での恋愛ADV購入 (章 / アイテム)
// ---------------------------------------------------------------------

export type PuiGamePurchaseResult =
  | { ok: true; balance: number; purchaseId: string }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_FOR_SALE' | 'ALREADY_OWNED' | 'OWN_LIMIT_EXCEEDED' };

/**
 * 恋愛ADVの章 (GameScenario) を Pui で購入する。
 *  - puiPrice が null/0 の章は Pui 購入不可。
 *  - 既に所持していれば ALREADY_OWNED。
 *  - Pui 残高不足時は applyPui が PuiIntegrityError を投げ、
 *    トランザクション全体 (購入記録・所持追加を含む) がロールバックされる。
 */
export async function purchaseScenarioWithPui(
  userId: string,
  scenarioId: string,
): Promise<PuiGamePurchaseResult> {
  return prisma.$transaction(async (tx) => {
    const sc = await tx.gameScenario.findUnique({ where: { id: scenarioId } });
    if (!sc || sc.status !== 'PUBLISHED') return { ok: false, reason: 'NOT_FOUND' };
    if (!sc.puiPrice || sc.puiPrice <= 0) {
      return { ok: false, reason: 'NOT_FOR_SALE' };
    }
    const owned = await tx.playerInventory.findUnique({
      where: { userId_scenarioId: { userId, scenarioId: sc.id } },
    });
    if (owned) return { ok: false, reason: 'ALREADY_OWNED' };

    const balance = await applyPui(tx, {
      userId,
      amount: -sc.puiPrice,
      reason: 'ITEM_PURCHASE',
      note: `${sc.title} を Pui で購入`,
    });

    const purchase = await tx.playerPurchase.create({
      data: {
        userId,
        kind: 'SCENARIO',
        scenarioId: sc.id,
        quantity: 1,
        payMethod: 'PUI',
        amountJpy: 0,
        puiAmount: sc.puiPrice,
        paymentStatus: 'SUCCEEDED',
        paidAt: new Date(),
      },
    });

    await tx.playerInventory.upsert({
      where: { userId_scenarioId: { userId, scenarioId: sc.id } },
      create: { userId, scenarioId: sc.id, quantity: 1 },
      update: {},
    });

    return { ok: true, balance, purchaseId: purchase.id };
  });
}

/**
 * 恋愛ADVのアイテム (GameItem) を Pui で購入する。
 *  - puiPrice が null/0 のアイテムは Pui 購入不可。
 *  - maxOwn (所持上限) を超える場合は OWN_LIMIT_EXCEEDED。
 */
export async function purchaseItemWithPui(
  userId: string,
  itemId: string,
  quantity: number,
): Promise<PuiGamePurchaseResult> {
  return prisma.$transaction(async (tx) => {
    const it = await tx.gameItem.findUnique({ where: { id: itemId } });
    if (!it || !it.isActive) return { ok: false, reason: 'NOT_FOUND' };
    if (!it.puiPrice || it.puiPrice <= 0) {
      return { ok: false, reason: 'NOT_FOR_SALE' };
    }
    if (it.maxOwn) {
      const inv = await tx.playerInventory.findUnique({
        where: { userId_itemId: { userId, itemId: it.id } },
      });
      if (inv && inv.quantity + quantity > it.maxOwn) {
        return { ok: false, reason: 'OWN_LIMIT_EXCEEDED' };
      }
    }

    const totalCost = it.puiPrice * quantity;
    const balance = await applyPui(tx, {
      userId,
      amount: -totalCost,
      reason: 'ITEM_PURCHASE',
      note: `${it.name} × ${quantity} を Pui で購入`,
    });

    const purchase = await tx.playerPurchase.create({
      data: {
        userId,
        kind: 'ITEM',
        itemId: it.id,
        quantity,
        payMethod: 'PUI',
        amountJpy: 0,
        puiAmount: totalCost,
        paymentStatus: 'SUCCEEDED',
        paidAt: new Date(),
      },
    });

    const inv = await tx.playerInventory.findUnique({
      where: { userId_itemId: { userId, itemId: it.id } },
    });
    if (inv) {
      await tx.playerInventory.update({
        where: { id: inv.id },
        data: { quantity: inv.quantity + quantity },
      });
    } else {
      await tx.playerInventory.create({ data: { userId, itemId: it.id, quantity } });
    }

    return { ok: true, balance, purchaseId: purchase.id };
  });
}

// ---------------------------------------------------------------------
// 整合性検証 / 異常検知 (管理者が Pui の不正・バグを監視するための土台)
// ---------------------------------------------------------------------

export type PuiIntegrityRow = {
  userId: string;
  email: string | null;
  memberNumber: string | null;
  /** User.pui に記録された残高 */
  storedBalance: number;
  /** PointTransaction.amount の合計 (本来あるべき残高) */
  ledgerSum: number;
  /** storedBalance - ledgerSum。0 以外なら不整合 */
  diff: number;
  /** 取引件数 */
  txCount: number;
};

/**
 * 全ユーザーについて「User.pui」と「PuiTransaction の合計」を突き合わせ、
 * 不整合 (diff !== 0) または残高がマイナスのユーザーを返す。
 *
 * これにより、バグ・不正・手動 DB 改変などで残高が台帳とズレた場合に
 * 管理者が検知できる。台帳 (PointTransaction) を信頼の基点とする。
 */
export async function findPuiAnomalies(): Promise<PuiIntegrityRow[]> {
  // 台帳の合計をユーザー単位で集計
  const sums = await prisma.puiTransaction.groupBy({
    by: ['userId'],
    _sum: { amount: true },
    _count: { _all: true },
  });
  const ledgerByUser = new Map<string, { sum: number; count: number }>(
    sums.map((s) => [s.userId, { sum: s._sum.amount ?? 0, count: s._count._all }]),
  );

  // 残高が 0 以外、または台帳に記録のあるユーザーを対象に突合
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { pui: { not: 0 } },
        { id: { in: Array.from(ledgerByUser.keys()) } },
      ],
    },
    select: { id: true, email: true, memberNumber: true, pui: true },
  });

  const anomalies: PuiIntegrityRow[] = [];
  for (const u of users) {
    const ledger = ledgerByUser.get(u.id) ?? { sum: 0, count: 0 };
    const diff = u.pui - ledger.sum;
    if (diff !== 0 || u.pui < 0) {
      anomalies.push({
        userId: u.id,
        email: u.email,
        memberNumber: u.memberNumber,
        storedBalance: u.pui,
        ledgerSum: ledger.sum,
        diff,
        txCount: ledger.count,
      });
    }
  }
  // 台帳にだけ存在しユーザーが集計対象外だったケース (pui===0 だが ledgerSum!==0)
  for (const [userId, ledger] of ledgerByUser) {
    if (!users.some((u) => u.id === userId) && ledger.sum !== 0) {
      anomalies.push({
        userId,
        email: null,
        memberNumber: null,
        storedBalance: 0,
        ledgerSum: ledger.sum,
        diff: 0 - ledger.sum,
        txCount: ledger.count,
      });
    }
  }
  return anomalies.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}

/**
 * 単一ユーザーの整合性を検証する。diff === 0 なら整合。
 */
export async function verifyUserPuiIntegrity(
  userId: string,
): Promise<{ ok: boolean; storedBalance: number; ledgerSum: number; diff: number }> {
  const [user, agg] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { pui: true } }),
    prisma.puiTransaction.aggregate({
      where: { userId },
      _sum: { amount: true },
    }),
  ]);
  const storedBalance = user?.pui ?? 0;
  const ledgerSum = agg._sum.amount ?? 0;
  const diff = storedBalance - ledgerSum;
  return { ok: diff === 0 && storedBalance >= 0, storedBalance, ledgerSum, diff };
}

/**
 * 不整合を台帳 (PointTransaction) 基準で是正する (管理者操作)。
 *
 * 台帳を信頼の基点とし、User.pui を台帳合計に一致させる。
 * 台帳自体は正しい前提なので新たな取引は作らず、残高スナップショットのみ修正する。
 * 監査ログは呼び出し側 (API) で記録する。
 */
export async function reconcileUserPui(
  userId: string,
): Promise<{ before: number; after: number; diff: number }> {
  return prisma.$transaction(async (tx) => {
    const [user, agg] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { pui: true } }),
      tx.puiTransaction.aggregate({ where: { userId }, _sum: { amount: true } }),
    ]);
    if (!user) throw new PuiIntegrityError('対象ユーザーが見つかりません');
    const before = user.pui;
    const ledgerSum = agg._sum.amount ?? 0;

    if (before !== ledgerSum) {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { pui: ledgerSum },
        select: { pui: true },
      });
      return { before, after: updated.pui, diff: ledgerSum - before };
    }
    return { before, after: before, diff: 0 };
  });
}

// ---------------------------------------------------------------------
// ミニゲーム (あっちむいてPUI)
// ---------------------------------------------------------------------

/**
 * ユーザー単位で「本日のプレイ回数上限チェック → 記録」を直列化するための
 * トランザクションスコープ advisory lock を取得する。
 *
 * なぜ必要か:
 *  - あっちむいてPUI のプレイ記録 (MiniGamePlay) には日次のユニーク制約が無い
 *    (1 日に複数回プレイできるため)。上限判定は「トランザクション内で count →
 *    上限未満なら create」で行うが、PostgreSQL の既定分離レベル READ COMMITTED
 *    では、同一ユーザーの並列リクエスト (二重送信 / 連打 / PM2 cluster の別プロセス)
 *    が両方とも同じ count を読み、両方が create を通してしまう「Read-Modify-Write
 *    競合」が起こり得る。→ 上限を超えたプレイ = 無料報酬 (Pui) の
 *    超過付与という不正が成立してしまう。
 *  - 追加プレイ購入 (buyAcchiExtraPlay) も同様に、並列だと購入上限
 *    (MAX_EXTRA_PLAYS_PER_DAY) を超えて購入 (=Pui 多重消費) され得る。
 *
 * 対策:
 *  - pg_advisory_xact_lock(key1, key2) を使い、(userId, gameType) をキーに
 *    トランザクションを直列化する。ロックはトランザクション終了時 (COMMIT/ROLLBACK)
 *    に自動解放されるため、明示的な解放漏れが起きない。
 *  - advisory lock は DB (RDS) 全体で有効なので、PM2 cluster の複数プロセス間でも
 *    確実に排他できる。
 *
 * @param client トランザクションクライアント (必ず $transaction 内で呼ぶこと)
 * @param userId 対象ユーザー ID (UUID 文字列)
 * @param scope  ロックのサブキー (ゲーム種別ごとに分ける)
 */
async function acquireUserGameLock(
  client: Prisma.TransactionClient,
  userId: string,
  scope: string,
): Promise<void> {
  // UUID 文字列 + scope を 32bit ずつのキー 2 本 (計 64bit) に落とし込む。
  // pg_advisory_xact_lock(int4, int4) はキーの組み合わせで排他されるため、
  // 別ユーザー / 別ゲームのロック同士は互いにブロックしない。
  //
  // 【重要 / 22003 "integer out of range" 対策】
  //   Prisma の $executeRaw はテンプレートの ${key} を「バインドパラメータ」として送る。
  //   このとき Prisma は JS の number を int4 ではなく int8(bigint)/numeric として送るため、
  //   PostgreSQL 側では「int8 の値を pg_advisory_xact_lock(int4, int4) に渡す」形になり、
  //   値が int4 範囲を 1 でも外れると即 22003 (integer out of range) で失敗する。
  //   (JS 側の hashStringToInt32 は int4 に収めているが、パラメータの型付け次第で
  //    暗黙変換の境界チェックに引っかかる余地が残る。)
  //
  //   → SQL 側で明示的に (( $1 & x'7fffffff'::bigint ) - ... ) 等の演算をせず、
  //     単純かつ確実に「int8 → int4 へラップする」よう、#>> ではなく
  //     ((key % 2147483648) の符号調整) を避け、下位 32bit を取り出して int4 化する。
  //     具体的には (key::bigint & 4294967295) を 0..2^32-1 にし、そこから 2^32 を引いて
  //     符号付き int4 相当へ丸めてから ::int にキャストする。これで JS からどんな整数が
  //     来ても pg_advisory_xact_lock(int4, int4) が範囲エラーにならない。
  const key1 = hashStringToInt32(userId);
  const key2 = hashStringToInt32(scope);
  await client.$executeRaw`
    SELECT pg_advisory_xact_lock(
      (((${key1}::bigint & 4294967295) + 2147483648) % 4294967296 - 2147483648)::int,
      (((${key2}::bigint & 4294967295) + 2147483648) % 4294967296 - 2147483648)::int
    )`;
}

/**
 * 任意の文字列を符号付き 32bit 整数 (PostgreSQL int4 の範囲) に決定論的に変換する。
 * advisory lock のキー用。衝突しても「別ユーザーが同じロックを共有する」だけで
 * 正当性 (超過付与の防止) は損なわれないが、実用上は十分に分散する FNV-1a を使う。
 *
 * @internal テスト用に export している (通常は acquireUserGameLock 経由で使う)。
 */
export function hashStringToInt32(input: string): number {
  let hash = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV prime 乗算 (32bit へ収める)
    hash = Math.imul(hash, 0x01000193);
  }
  // >>> 0 で unsigned 32bit にした後、int4 (符号付き) に変換する。
  return (hash >>> 0) | 0;
}

/**
 * プロモ/デモアカウント (回数無制限) のときに `remaining` として返す大きな値。
 * UI 側は promoActive フラグで「∞」表示にするが、数値としても十分大きくして
 * 「残り 0 で終了」扱いにならないようにする。
 */
export const PROMO_UNLIMITED_REMAINING = 9999;

/**
 * ユーザーの promo_until を「壊れないように」取得する。
 *
 * `promo_until` カラムは後から追加したものなので、本番でマイグレーション
 * (20260713000000_add_user_promo_until) が未適用だと、Prisma の
 * `select: { promoUntil: true }` は「column does not exist」で例外になる。
 * その例外がゲーム API 全体を 500 (サーバーエラー) に落としてしまうため、
 * ここでは生 SQL + try/catch で安全に読み、カラムが無い/失敗した場合は
 * null (= プロモ無効・通常アカウント) にフォールバックする。
 *
 * マイグレーション適用後は自動的にプロモが機能する (コード変更不要)。
 *
 * 【重要・トランザクション内では呼ばないこと】
 * PostgreSQL では、1 度でもエラーを起こしたトランザクションは "aborted" 状態になり、
 * 以降そのトランザクション内の全クエリが失敗する。この関数は promo_until カラムが
 * 未適用のとき生 SQL が失敗する (例外は握り潰すが、トランザクションは汚染される)。
 * そのため $transaction のコールバック内で tx を渡して呼ぶと、後続の
 * tx.xxx.create(...) 等が "current transaction is aborted" で落ちてしまう。
 * → 必ずトランザクションの「外」でトップレベルの prisma を渡して呼び、
 *   結果 (promoActive) だけをトランザクション内へ持ち込むこと。
 *
 * @param client トップレベルの prisma クライアント (トランザクションクライアント不可)
 */
export async function safeGetPromoUntil(
  client: Pick<typeof prisma, '$queryRaw'>,
  userId: string,
): Promise<Date | null> {
  try {
    // users.id は uuid 型。パラメータは text としてバインドされるため、明示的に
    // ::uuid へキャストしないと "operator does not exist: uuid = text" で失敗する。
    // (このキャストが無いと、カラムが存在していても常に catch に落ちてプロモが
    //  永久に無効化されてしまう。)
    const rows = await client.$queryRaw<Array<{ promo_until: Date | null }>>(
      Prisma.sql`SELECT "promo_until" FROM "users" WHERE "id" = ${userId}::uuid LIMIT 1`,
    );
    return rows[0]?.promo_until ?? null;
  } catch (e) {
    // カラム未追加 (マイグレーション未適用) 等。プロモ無効として扱う。
    console.error('[safeGetPromoUntil] failed (treating as non-promo)', e);
    return null;
  }
}

/**
 * ユーザーの promo_until を「壊れないように」書き込む (プロモ付与 / 解除)。
 *
 * promo_until は Prisma モデルに載せていない (カラム未適用の DB で全 user 操作が
 * 壊れるのを防ぐため) ので、書き込みも生 SQL で行う。
 *
 * @returns 書き込みに成功したか。カラム未適用 (マイグレーション未実行) の場合は
 *          false を返す (呼び出し側で「マイグレーション未適用」を案内できる)。
 */
export async function safeSetPromoUntil(
  client: Pick<typeof prisma, '$executeRaw'>,
  userId: string,
  promoUntil: Date | null,
): Promise<boolean> {
  try {
    await client.$executeRaw(
      Prisma.sql`UPDATE "users" SET "promo_until" = ${promoUntil} WHERE "id" = ${userId}::uuid`,
    );
    return true;
  } catch (e) {
    // カラム未追加 (マイグレーション未適用) 等。
    console.error('[safeSetPromoUntil] failed', e);
    return false;
  }
}

export type AcchiPlayPersistResult = {
  /** 受理されたか (回数上限に達していれば false) */
  accepted: boolean;
  /** 受理時に作成された MiniGamePlay の id (拒否時は undefined)。監査用。 */
  playId?: string;
  /** プロモ/デモアカウントとしてプレイされたか (true なら回数無制限)。 */
  promoActive: boolean;
  /** ゲーム結果 (受理時のみ意味を持つ) */
  result: AcchiResult;
  /** 付与 Pui (勝利時のみ > 0) */
  reward: number;
  /** プレイ後の残高 (Pui) */
  balance: number;
  /** プレイ後の本日プレイ回数 */
  playedToday: number;
  /** プレイ後の本日残り回数 (Pui 購入分の追加回数を含む) */
  remaining: number;
  /** 本日の上限回数 (標準上限 + Pui 購入分) */
  maxPerDay: number;
};

/**
 * 本日のあっちむいてPUIのプレイ回数を取得する (JST 基準)。
 */
export async function getAcchiPlayCountToday(
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const date = jstDateKey(now);
  return prisma.miniGamePlay.count({
    where: { userId, gameType: 'ACCHI_MUITE_HOI', date },
  });
}

/**
 * 本日、Pui で購入済みの追加プレイ回数を取得する (JST 基準)。
 */
export async function getAcchiExtraPlaysToday(
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const date = jstDateKey(now);
  const row = await prisma.miniGameExtraPlayPurchase.findUnique({
    where: { userId_gameType_date: { userId, gameType: 'ACCHI_MUITE_HOI', date } },
  });
  return row?.purchasedCount ?? 0;
}

/**
 * 本日の実効上限 (標準上限 + Pui 購入分) を取得する。
 */
export async function getAcchiEffectiveMaxPerDay(
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const extra = await getAcchiExtraPlaysToday(userId, now);
  return ACCHI_MAX_PLAYS_PER_DAY + extra;
}

/**
 * あっちむいてPUIの 1 プレイをサーバー側で確定・記録する。
 *
 * セキュリティ上の不変条件:
 *  - 勝敗 (result) は API ハンドラ側がサーバー生成の乱数で確定したものを受け取る。
 *    クライアントから結果や Pui を直接受け取らない (改ざん不可)。
 *  - 「1 日 N 回まで」の上限チェック、プレイ記録の作成、Pui 付与を
 *    すべて同一トランザクション内で実行し、cluster 並列でも超過付与を防ぐ。
 *  - 上限は「標準上限 (ACCHI_MAX_PLAYS_PER_DAY) + Pui で購入した追加回数」。
 *  - 上限到達時は accepted=false を返し、記録も付与も行わない。
 *  - 付与は result==='WIN' のときのみ。それ以外は 0pt (記録のみ)。
 *
 * @param result   サーバーが確定したプレイ結果
 * @param detail   監査用の手の記録 (JSON 文字列など)。任意。
 */
export async function recordAcchiPlay(
  userId: string,
  result: AcchiResult,
  detail?: string,
  now: Date = new Date(),
): Promise<AcchiPlayPersistResult> {
  const date = jstDateKey(now);

  // 【重要】promo_until の読み取りはトランザクションの「外」で行う。
  //
  // 以前は $transaction 内で safeGetPromoUntil(tx, ...) を呼んでいたが、
  // promo_until カラムが未適用 (マイグレーション未実行) の本番では、この生 SQL が
  // 「column does not exist」で失敗する。try/catch で例外自体は握り潰せるものの、
  // PostgreSQL では 1 度でもエラーを起こしたトランザクションは "aborted" 状態になり、
  // 以降の全クエリが "current transaction is aborted" で失敗する。
  // その結果 tx.miniGamePlay.create(...) が落ち、ゲーム全体が 500 (サーバーエラー) になる。
  //
  // → promo_until はトランザクション開始前に独立した接続で安全に読み、
  //   トランザクション内では一切生 SQL を投げないことでこの問題を回避する。
  const promoUntil = await safeGetPromoUntil(prisma, userId);
  const promoActive = isPromoActive(promoUntil, now);

  return prisma.$transaction(async (tx) => {
    // 【競合対策】同一ユーザー・同一ゲームの「上限チェック → 記録」を直列化する。
    // これがないと READ COMMITTED 下で並列リクエストが同じ count を読み、
    // 両方が上限判定を通過して上限超過プレイ (無料報酬の超過付与) が成立し得る。
    await acquireUserGameLock(tx, userId, 'ACCHI_MUITE_HOI:play');

    // プラン別の Pui 付与率を適用 (FREE ×1.0 / STANDARD ×1.2 / PREMIUM ×2.0)
    const plan = await getUserPlanTx(tx, userId);
    const reward =
      result === 'WIN' ? applyPlanPuiMultiplier(ACCHI_WIN_REWARD, plan) : 0;

    // トランザクション内で当日プレイ数・Pui 購入済み追加回数を数え、
    // 上限チェック (競合に強い)。
    // ※ promo_until はトランザクション外で取得済み (上記コメント参照)。
    const [playedBefore, extraRow] = await Promise.all([
      tx.miniGamePlay.count({ where: { userId, gameType: 'ACCHI_MUITE_HOI', date } }),
      tx.miniGameExtraPlayPurchase.findUnique({
        where: { userId_gameType_date: { userId, gameType: 'ACCHI_MUITE_HOI', date } },
      }),
    ]);
    // プロモ/デモアカウントは 1 日の回数上限を撤廃する (何度でもプレイ可能)。
    const maxPerDay = ACCHI_MAX_PLAYS_PER_DAY + (extraRow?.purchasedCount ?? 0);

    if (!promoActive && playedBefore >= maxPerDay) {
      const u = await tx.user.findUnique({
        where: { id: userId },
        select: { pui: true },
      });
      return {
        accepted: false,
        promoActive: false,
        result,
        reward: 0,
        balance: u?.pui ?? 0,
        playedToday: playedBefore,
        remaining: 0,
        maxPerDay,
      };
    }

    const createdPlay = await tx.miniGamePlay.create({
      data: {
        userId,
        gameType: 'ACCHI_MUITE_HOI',
        date,
        result,
        rewardPui: reward,
        detail: detail ?? null,
      },
      select: { id: true },
    });

    let balance: number;
    if (reward > 0) {
      balance = await applyPui(tx, {
        userId,
        amount: reward,
        reason: 'GAME_REWARD',
        note: 'あっちむいてPUI 勝利報酬',
      });
    } else {
      const u = await tx.user.findUnique({
        where: { id: userId },
        select: { pui: true },
      });
      balance = u?.pui ?? 0;
    }

    const playedToday = playedBefore + 1;
    return {
      accepted: true,
      playId: createdPlay.id,
      promoActive,
      result,
      reward,
      balance,
      playedToday,
      // プロモ時は回数無制限のため、残りは常に大きな値を返す (UI は promoActive で「∞」表示)。
      remaining: promoActive ? PROMO_UNLIMITED_REMAINING : remainingPlays(playedToday, maxPerDay),
      maxPerDay,
    };
  });
}

export type BuyExtraPlayResult =
  | { ok: true; balance: number; purchasedToday: number; maxPerDay: number }
  | { ok: false; reason: 'LIMIT_REACHED' };

/**
 * ミニゲーム (あっちむいてPUI) の追加プレイ回数を Pui で購入する。
 *  - 1 日に購入できる追加回数には上限がある (MAX_EXTRA_PLAYS_PER_DAY)。
 *  - Pui 残高不足時は applyPui が PuiIntegrityError を投げ、
 *    トランザクション全体 (購入回数の加算を含む) がロールバックされる。
 */
export async function buyAcchiExtraPlay(
  userId: string,
  now: Date = new Date(),
): Promise<BuyExtraPlayResult> {
  const date = jstDateKey(now);

  return prisma.$transaction(async (tx) => {
    // 【競合対策】追加プレイ購入も並列だと購入上限を超えて購入 (Pui 多重消費)
    // され得るため、同一ユーザー・同一ゲームで直列化する。
    // (プレイ記録と同じロックキーを使い、購入とプレイの相互の競合もまとめて排他する)
    await acquireUserGameLock(tx, userId, 'ACCHI_MUITE_HOI:play');

    const existing = await tx.miniGameExtraPlayPurchase.findUnique({
      where: { userId_gameType_date: { userId, gameType: 'ACCHI_MUITE_HOI', date } },
    });
    const purchasedBefore = existing?.purchasedCount ?? 0;

    if (purchasedBefore >= MAX_EXTRA_PLAYS_PER_DAY) {
      return { ok: false, reason: 'LIMIT_REACHED' as const };
    }

    const balance = await applyPui(tx, {
      userId,
      amount: -EXTRA_PLAY_COST_PUI,
      reason: 'EXTRA_PLAY_PURCHASE',
      note: 'あっちむいてPUI 追加プレイ購入',
    });

    if (existing) {
      await tx.miniGameExtraPlayPurchase.update({
        where: { id: existing.id },
        data: {
          purchasedCount: { increment: 1 },
          totalPuiSpent: { increment: EXTRA_PLAY_COST_PUI },
        },
      });
    } else {
      await tx.miniGameExtraPlayPurchase.create({
        data: {
          userId,
          gameType: 'ACCHI_MUITE_HOI',
          date,
          purchasedCount: 1,
          totalPuiSpent: EXTRA_PLAY_COST_PUI,
        },
      });
    }

    const purchasedToday = purchasedBefore + 1;
    return {
      ok: true as const,
      balance,
      purchasedToday,
      maxPerDay: ACCHI_MAX_PLAYS_PER_DAY + purchasedToday,
    };
  });
}

// ---------------------------------------------------------------------
// スロット (ミニゲーム)
//
// あっち向いてホイと同じテーブル (mini_game_plays /
// mini_game_extra_play_purchases) を gameType='SLOT' で共用する。
// 新テーブルを作らないことで、Pui 整合性チェック・プレイ履歴・追加プレイ購入など
// 既存の仕組みがそのままスロットにも効く。
//
// 上限判定 → 記録 → Pui 付与 を同一トランザクション + advisory lock で直列化する
// 点も同じ (PM2 cluster の並列リクエストによる超過付与を防ぐ)。
// ---------------------------------------------------------------------

/** advisory lock のスコープ。あっち向いてホイとは別ゲーム扱いで独立して排他する。 */
const SLOT_LOCK_SCOPE = 'SLOT:play';

export type SlotPlayPersistResult = {
  /** 受理されたか (回数上限に達していれば false) */
  accepted: boolean;
  /** 受理時に作成された MiniGamePlay の id (拒否時は undefined)。監査用。 */
  playId?: string;
  /** プロモ/デモアカウントとしてプレイされたか (true なら回数無制限)。 */
  promoActive: boolean;
  /** 付与 Pui (プラン倍率適用後。はずれなら 0) */
  reward: number;
  /** プレイ後の残高 (Pui) */
  balance: number;
  /** プレイ後の本日プレイ回数 */
  playedToday: number;
  /** プレイ後の本日残り回数 (Pui 購入分の追加回数を含む) */
  remaining: number;
  /** 本日の上限回数 (標準上限 + Pui 購入分) */
  maxPerDay: number;
};

/** 本日のスロットのプレイ回数を取得する (JST 基準)。 */
export async function getSlotPlayCountToday(
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const date = jstDateKey(now);
  return prisma.miniGamePlay.count({
    where: { userId, gameType: 'SLOT', date },
  });
}

/** 本日、Pui で購入済みのスロット追加プレイ回数を取得する (JST 基準)。 */
export async function getSlotExtraPlaysToday(
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const date = jstDateKey(now);
  const row = await prisma.miniGameExtraPlayPurchase.findUnique({
    where: { userId_gameType_date: { userId, gameType: 'SLOT', date } },
  });
  return row?.purchasedCount ?? 0;
}

/** 本日のスロットの実効上限 (標準上限 + Pui 購入分) を取得する。 */
export async function getSlotEffectiveMaxPerDay(
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const extra = await getSlotExtraPlaysToday(userId, now);
  return SLOT_MAX_PLAYS_PER_DAY + extra;
}

/**
 * スロットの 1 プレイをサーバー側で確定・記録する。
 *
 * セキュリティ上の不変条件 (recordAcchiPlay と同じ):
 *  - 役 (outcome) と配当は API ハンドラ側がサーバー生成の暗号論的乱数で確定したものを
 *    受け取る。クライアントから結果や Pui を直接受け取らない (改ざん不可)。
 *  - 「1 日 N 回まで」の上限チェック、プレイ記録の作成、Pui 付与を
 *    すべて同一トランザクション + advisory lock 内で実行する。
 *  - 上限到達時は accepted=false を返し、記録も付与も行わない (Pui も動かない)。
 *
 * 【重要】basePayout は「役ごとのベース配当」であり、プラン倍率はこの関数の中で
 * 掛ける。呼び出し側で倍率を掛けて渡すと二重適用になるので注意。
 *
 * @param userId      プレイヤー
 * @param outcome     サーバーが確定した役
 * @param basePayout  役に対応するベース配当 (プラン倍率適用前)
 * @param detail      監査用の詳細 (JSON 文字列)。停止絵柄などを入れる。
 */
export async function recordSlotPlay(
  userId: string,
  outcome: SlotOutcome,
  basePayout: number,
  detail?: string,
  now: Date = new Date(),
): Promise<SlotPlayPersistResult> {
  const date = jstDateKey(now);

  // 【重要】promo_until の読み取りはトランザクションの「外」で行う。
  // トランザクション内で生 SQL が失敗すると PostgreSQL のトランザクションが
  // aborted 状態になり、以降の全クエリが落ちてゲームが 500 になるため。
  // (詳細は recordAcchiPlay のコメント参照)
  const promoUntil = await safeGetPromoUntil(prisma, userId);
  const promoActive = isPromoActive(promoUntil, now);

  return prisma.$transaction(async (tx) => {
    // 【競合対策】同一ユーザー・スロットの「上限チェック → 記録」を直列化する。
    await acquireUserGameLock(tx, userId, SLOT_LOCK_SCOPE);

    // プラン別の Pui 付与率を適用 (FREE ×1.0 / STANDARD ×1.2 / PREMIUM ×2.0)
    const plan = await getUserPlanTx(tx, userId);
    const reward = basePayout > 0 ? applyPlanPuiMultiplier(basePayout, plan) : 0;

    const [playedBefore, extraRow] = await Promise.all([
      tx.miniGamePlay.count({ where: { userId, gameType: 'SLOT', date } }),
      tx.miniGameExtraPlayPurchase.findUnique({
        where: { userId_gameType_date: { userId, gameType: 'SLOT', date } },
      }),
    ]);
    const maxPerDay = SLOT_MAX_PLAYS_PER_DAY + (extraRow?.purchasedCount ?? 0);

    // プロモ/デモアカウントは 1 日の回数上限を撤廃する。
    if (!promoActive && playedBefore >= maxPerDay) {
      const u = await tx.user.findUnique({
        where: { id: userId },
        select: { pui: true },
      });
      return {
        accepted: false,
        promoActive: false,
        reward: 0,
        balance: u?.pui ?? 0,
        playedToday: playedBefore,
        remaining: 0,
        maxPerDay,
      };
    }

    // MiniGameResult は WIN/LOSE/DRAW の 3 値しかないため、
    // 「配当があれば WIN / なければ LOSE」に丸めて保存する。
    // 役そのもの (SEVEN_TRIPLE など) は detail に JSON で残す。
    const createdPlay = await tx.miniGamePlay.create({
      data: {
        userId,
        gameType: 'SLOT',
        date,
        result: reward > 0 ? 'WIN' : 'LOSE',
        rewardPui: reward,
        detail: detail ?? null,
      },
      select: { id: true },
    });

    let balance: number;
    if (reward > 0) {
      balance = await applyPui(tx, {
        userId,
        amount: reward,
        reason: 'GAME_REWARD',
        note: `スロット ${outcome} 配当`,
      });
    } else {
      const u = await tx.user.findUnique({
        where: { id: userId },
        select: { pui: true },
      });
      balance = u?.pui ?? 0;
    }

    const playedToday = playedBefore + 1;
    return {
      accepted: true,
      playId: createdPlay.id,
      promoActive,
      reward,
      balance,
      playedToday,
      remaining: promoActive
        ? PROMO_UNLIMITED_REMAINING
        : slotRemainingPlays(playedToday, maxPerDay),
      maxPerDay,
    };
  });
}

/**
 * スロットの追加プレイ回数を Pui で購入する。
 *  - 1 日に購入できる追加回数には上限がある (MAX_EXTRA_PLAYS_PER_DAY)。
 *  - Pui 残高不足時は applyPui が PuiIntegrityError を投げ、
 *    トランザクション全体 (購入回数の加算を含む) がロールバックされる。
 */
export async function buySlotExtraPlay(
  userId: string,
  now: Date = new Date(),
): Promise<BuyExtraPlayResult> {
  const date = jstDateKey(now);

  return prisma.$transaction(async (tx) => {
    // プレイ記録と同じロックキーで、購入とプレイの相互競合もまとめて排他する。
    await acquireUserGameLock(tx, userId, SLOT_LOCK_SCOPE);

    const existing = await tx.miniGameExtraPlayPurchase.findUnique({
      where: { userId_gameType_date: { userId, gameType: 'SLOT', date } },
    });
    const purchasedBefore = existing?.purchasedCount ?? 0;

    if (purchasedBefore >= MAX_EXTRA_PLAYS_PER_DAY) {
      return { ok: false, reason: 'LIMIT_REACHED' as const };
    }

    const balance = await applyPui(tx, {
      userId,
      amount: -EXTRA_PLAY_COST_PUI,
      reason: 'EXTRA_PLAY_PURCHASE',
      note: 'スロット 追加プレイ購入',
    });

    if (existing) {
      await tx.miniGameExtraPlayPurchase.update({
        where: { id: existing.id },
        data: {
          purchasedCount: { increment: 1 },
          totalPuiSpent: { increment: EXTRA_PLAY_COST_PUI },
        },
      });
    } else {
      await tx.miniGameExtraPlayPurchase.create({
        data: {
          userId,
          gameType: 'SLOT',
          date,
          purchasedCount: 1,
          totalPuiSpent: EXTRA_PLAY_COST_PUI,
        },
      });
    }

    const purchasedToday = purchasedBefore + 1;
    return {
      ok: true as const,
      balance,
      purchasedToday,
      maxPerDay: SLOT_MAX_PLAYS_PER_DAY + purchasedToday,
    };
  });
}

// ---------------------------------------------------------------------
// Pui 購入 (Stripe) / サブスク月次特典 / 景品交換
//
// 【2026-07 統合】以前はここで「特典ポイント (User.rewardPoints /
// RewardPointTransaction)」という Fan ポイントとは別枠の通貨を増減していたが、
// Fan ポイント 1 種類への統合により、以下の関数はすべて applyPui
// (User.pui / PuiTransaction) を使うようになった。関数名・テーブル名
// (RewardPointPurchase 等) は変更していない。
// ---------------------------------------------------------------------

export type PuiPackPurchaseConfirmResult =
  | { ok: true; balance: number }
  | { ok: false; reason: 'NOT_FOUND' | 'ALREADY_PROCESSED' };

/**
 * Stripe 決済確定 (webhook) を受けて Pui を付与する。
 *  - RewardPointPurchase.status が既に SUCCEEDED なら二重付与しない。
 *  - purchaseId は RewardPointPurchase.id (checkout 作成時に発行済み)。
 */
export async function grantPuiFromStripePurchase(
  purchaseId: string,
  opts?: { stripePaymentIntentId?: string | null },
): Promise<PuiPackPurchaseConfirmResult> {
  return prisma.$transaction(async (tx) => {
    const purchase = await tx.rewardPointPurchase.findUnique({ where: { id: purchaseId } });
    if (!purchase) return { ok: false, reason: 'NOT_FOUND' };
    if (purchase.status === 'SUCCEEDED') return { ok: false, reason: 'ALREADY_PROCESSED' };

    await tx.rewardPointPurchase.update({
      where: { id: purchaseId },
      data: {
        status: 'SUCCEEDED',
        paidAt: new Date(),
        stripePaymentIntentId: opts?.stripePaymentIntentId ?? purchase.stripePaymentIntentId,
      },
    });

    const balance = await applyPui(tx, {
      userId: purchase.userId,
      amount: purchase.pui,
      reason: 'STRIPE_PURCHASE',
      note: `Pui パック購入 (${purchase.pui} Pui / ¥${purchase.amountJpy.toLocaleString()})`,
    });

    return { ok: true, balance };
  });
}

export type MonthlyPuiGrantResult =
  | { granted: true; amount: number; balance: number }
  | { granted: false; reason: 'NO_BONUS_FOR_PLAN' | 'ALREADY_GRANTED' };

/**
 * サブスクプランに応じた月次 Pui 特典を自動付与する。
 *  - MonthlyRewardPointGrant (userId, yearMonth) のユニーク制約で二重付与を防止 (モデル名は維持)。
 *  - FREE プランは付与額 0 のため NO_BONUS_FOR_PLAN を返す。
 */
export async function grantMonthlyPuiBonus(
  userId: string,
  plan: PlanTypeLiteral,
  yearMonth: string,
): Promise<MonthlyPuiGrantResult> {
  const amount = MONTHLY_PUI_BONUS[plan] ?? 0;
  if (amount <= 0) return { granted: false, reason: 'NO_BONUS_FOR_PLAN' };

  try {
    const balance = await prisma.$transaction(async (tx) => {
      const existing = await tx.monthlyRewardPointGrant.findUnique({
        where: { userId_yearMonth: { userId, yearMonth } },
      });
      if (existing) throw new Error('ALREADY_GRANTED');

      await tx.monthlyRewardPointGrant.create({
        data: { userId, yearMonth, plan, pui: amount },
      });

      return applyPui(tx, {
        userId,
        amount,
        reason: 'SUBSCRIPTION_BONUS',
        note: `${plan} プラン ${yearMonth} 月次 Pui 特典`,
      });
    });
    return { granted: true, amount, balance };
  } catch (e) {
    if (e instanceof Error && e.message === 'ALREADY_GRANTED') {
      return { granted: false, reason: 'ALREADY_GRANTED' };
    }
    if (isUniqueViolation(e)) {
      return { granted: false, reason: 'ALREADY_GRANTED' };
    }
    throw e;
  }
}

export type RedeemCatalogItemResult =
  | { ok: true; redemptionId: string; balance: number }
  | {
      ok: false;
      reason: 'NOT_FOUND' | 'NOT_AVAILABLE' | 'OUT_OF_STOCK' | 'SHIPPING_REQUIRED';
    };

/**
 * 景品カタログ交換 (Pui 消費)。
 *  - stock が設定されている場合は在庫を原子的にデクリメントする。
 *  - GOODS (発送必要) は配送先情報が必須。
 *  - Pui 残高不足時は applyPui が PuiIntegrityError を投げ、
 *    トランザクション全体 (在庫デクリメント・交換記録を含む) がロールバックされる。
 */
export async function redeemRewardCatalogItem(
  userId: string,
  catalogItemId: string,
  shipping?: {
    shippingName?: string;
    shippingPhone?: string;
    shippingPostalCode?: string;
    shippingPrefecture?: string;
    shippingAddress1?: string;
    shippingAddress2?: string;
  },
): Promise<RedeemCatalogItemResult> {
  return prisma.$transaction(async (tx) => {
    const item = await tx.rewardCatalogItem.findUnique({ where: { id: catalogItemId } });
    if (!item) return { ok: false, reason: 'NOT_FOUND' };
    if (item.status !== 'PUBLISHED') return { ok: false, reason: 'NOT_AVAILABLE' };
    if (item.stock !== null && item.stock <= 0) return { ok: false, reason: 'OUT_OF_STOCK' };

    const needsShipping = requiresShipping(item.kind as RewardCatalogItemKindLiteral);
    if (needsShipping && (!shipping?.shippingName || !shipping?.shippingAddress1)) {
      return { ok: false, reason: 'SHIPPING_REQUIRED' };
    }

    // 在庫があれば原子的にデクリメント (競合時は WHERE 条件で 0 件更新 = 品切れ扱い)
    if (item.stock !== null) {
      const updated = await tx.rewardCatalogItem.updateMany({
        where: { id: item.id, stock: { gt: 0 } },
        data: { stock: { decrement: 1 } },
      });
      if (updated.count === 0) return { ok: false, reason: 'OUT_OF_STOCK' };
    }

    const balance = await applyPui(tx, {
      userId,
      amount: -item.puiCost,
      reason: 'REDEMPTION',
      note: `${item.name} と交換`,
    });

    const redemption = await tx.rewardRedemption.create({
      data: {
        userId,
        catalogItemId: item.id,
        itemName: item.name,
        itemKind: item.kind,
        puiCost: item.puiCost,
        status: 'PENDING',
        shippingName: needsShipping ? shipping?.shippingName : undefined,
        shippingPhone: needsShipping ? shipping?.shippingPhone : undefined,
        shippingPostalCode: needsShipping ? shipping?.shippingPostalCode : undefined,
        shippingPrefecture: needsShipping ? shipping?.shippingPrefecture : undefined,
        shippingAddress1: needsShipping ? shipping?.shippingAddress1 : undefined,
        shippingAddress2: needsShipping ? shipping?.shippingAddress2 : undefined,
      },
    });

    return { ok: true, redemptionId: redemption.id, balance };
  });
}

export type UpdateRedemptionStatusResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_FOUND' | 'INVALID_TRANSITION' };

/**
 * 景品交換の発送ステータスを更新する (管理者操作)。
 *  - 許可されたステータス遷移のみ受け付ける (REWARD_REDEMPTION_STATUS_TRANSITIONS)。
 *  - CANCELED へ遷移する場合は Pui を返還する (REFUND)。
 *  - SHIPPED/COMPLETED/CANCELED への遷移時は対応する日時カラムを記録する。
 */
export async function updateRedemptionStatus(
  redemptionId: string,
  next: RewardRedemptionStatusLiteral,
  opts?: { trackingNumber?: string; adminNote?: string },
): Promise<UpdateRedemptionStatusResult> {
  return prisma.$transaction(async (tx) => {
    const redemption = await tx.rewardRedemption.findUnique({ where: { id: redemptionId } });
    if (!redemption) return { ok: false, reason: 'NOT_FOUND' };

    const current = redemption.status as RewardRedemptionStatusLiteral;
    if (!canTransitionRedemptionStatus(current, next)) {
      return { ok: false, reason: 'INVALID_TRANSITION' };
    }

    const now = new Date();
    await tx.rewardRedemption.update({
      where: { id: redemptionId },
      data: {
        status: next,
        trackingNumber: opts?.trackingNumber ?? redemption.trackingNumber,
        adminNote: opts?.adminNote ?? redemption.adminNote,
        shippedAt: next === 'SHIPPED' ? now : redemption.shippedAt,
        completedAt: next === 'COMPLETED' ? now : redemption.completedAt,
        canceledAt: next === 'CANCELED' ? now : redemption.canceledAt,
      },
    });

    // キャンセル時は Pui を返還する
    if (next === 'CANCELED') {
      await applyPui(tx, {
        userId: redemption.userId,
        amount: redemption.puiCost,
        reason: 'REFUND',
        note: `${redemption.itemName} の交換キャンセルによる返還`,
      });
      // 在庫を戻す (無制限=null の場合は何もしない)
      const item = await tx.rewardCatalogItem.findUnique({
        where: { id: redemption.catalogItemId },
        select: { stock: true },
      });
      if (item && item.stock !== null) {
        await tx.rewardCatalogItem.update({
          where: { id: redemption.catalogItemId },
          data: { stock: { increment: 1 } },
        });
      }
    }

    return { ok: true };
  });
}
