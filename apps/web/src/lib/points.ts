/**
 * ポイント & 会員番号のサービス層。
 *
 * 設計上の要点 (本番 EC2 + PM2 cluster + RDS でも安全):
 *  - ポイント残高 (User.points) は PointTransaction の合計と一致させる。
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
  isValidPointAmount,
  MAX_POINTS_PER_TX as SHARED_MAX_POINTS_PER_TX,
  ACCHI_MAX_PLAYS_PER_DAY,
  ACCHI_WIN_REWARD,
  remainingPlays,
  applyPlanPointMultiplier,
  MONTHLY_REWARD_POINT_BONUS,
  EXTRA_PLAY_COST_FAN_POINTS,
  MAX_EXTRA_PLAYS_PER_DAY,
  requiresShipping,
  canTransitionRedemptionStatus,
  computeAcchiRewardBonus,
  DEFAULT_ACCHI_REWARD_BONUS_SETTINGS,
  isPromoActive,
  type AcchiRewardBonusSettings,
  type PointRateSettings,
  type PlanTypeLiteral,
  type SocialPlatformLiteral,
  type AcchiResult,
  type RewardPointReasonLiteral,
  type RewardCatalogItemKindLiteral,
  type RewardRedemptionStatusLiteral,
} from '@idol/shared';

type PointReasonLiteral =
  | 'LOGIN_BONUS'
  | 'LOGIN_STREAK'
  | 'SOCIAL_SHARE'
  | 'ADMIN_ADJUST'
  | 'SIGNUP_BONUS'
  | 'GAME_REWARD'
  | 'ITEM_PURCHASE'
  | 'EXTRA_PLAY_PURCHASE'
  | 'OTHER';

/**
 * 1 取引で動かせるポイントの絶対値上限 (防御的上限)。
 * 共有定義 (@idol/shared) を再エクスポートし、サーバ/クライアントで統一する。
 */
export const MAX_POINTS_PER_TX = SHARED_MAX_POINTS_PER_TX;

/** ポイント整合性に関する業務エラー (不正検知時に throw) */
export class PointIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PointIntegrityError';
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
 * ポイントを増減し、履歴を残す (内部用)。残高を返す。
 * tx を渡せば既存トランザクションに参加する。
 *
 * セキュリティ上の不変条件:
 *  - amount は整数かつ |amount| <= MAX_POINTS_PER_TX (異常な大量付与をブロック)。
 *  - amount === 0 は無意味なので拒否。
 *  - 残高 (User.points) は `increment` による原子的更新で、cluster 並列でも壊れない。
 *  - allowNegative=false (既定) のとき、更新後に残高が負になる操作を拒否し、
 *    同一トランザクション内なのでロールバックされる (二重消費・残高不足を防止)。
 *  - PointTransaction.balance には「更新後の実残高」を記録 (監査スナップショット)。
 */
async function applyPoints(
  client: Prisma.TransactionClient,
  params: {
    userId: string;
    amount: number;
    reason: PointReasonLiteral;
    note?: string;
    /** 残高がマイナスになる操作を許可するか (既定 false) */
    allowNegative?: boolean;
  },
): Promise<number> {
  // --- 入力値の防御的検証 (整数 / 非ゼロ / 上限以内) ---
  if (!isValidPointAmount(params.amount)) {
    if (!Number.isInteger(params.amount)) {
      throw new PointIntegrityError('ポイントは整数で指定してください');
    }
    if (params.amount === 0) {
      throw new PointIntegrityError('0 ポイントの取引は記録できません');
    }
    throw new PointIntegrityError(
      `1 取引で動かせるポイントは ±${MAX_POINTS_PER_TX} までです`,
    );
  }

  // increment は DB 側で原子的に実行され、cluster の並列付与でも競合しない。
  const user = await client.user.update({
    where: { id: params.userId },
    data: { points: { increment: params.amount } },
    select: { points: true },
  });

  // 残高がマイナスになる操作は (許可されていない限り) ロールバックさせる。
  if (!params.allowNegative && user.points < 0) {
    throw new PointIntegrityError('ポイント残高が不足しています');
  }

  await client.pointTransaction.create({
    data: {
      userId: params.userId,
      amount: params.amount,
      balance: user.points,
      reason: params.reason,
      note: params.note ?? null,
    },
  });
  return user.points;
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
  rates: PointRateSettings,
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
      select: { points: true },
    });
    return {
      granted: false,
      alreadyGranted: true,
      streak: existingToday.streak,
      balance: u?.points ?? 0,
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
      // プラン別のポイント付与率を適用 (FREE ×1.0 / STANDARD ×1.2 / PREMIUM ×2.0)
      const plan = await getUserPlanTx(tx, userId);
      const computedAmount = applyPlanPointMultiplier(baseAmount, plan);

      // ユニーク制約 (userId+date) で二重付与を防止
      await tx.loginBonusGrant.create({
        data: { userId, date: today, streak: computedStreak, amount: computedAmount },
      });
      const bal = await applyPoints(tx, {
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
        prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
      ]);
      return {
        granted: false,
        alreadyGranted: true,
        streak: grant?.streak ?? 0,
        balance: u?.points ?? 0,
      };
    }
    throw e;
  }
}

export type SocialShareResult =
  | { granted: true; amount: number; balance: number; alreadyGranted: false }
  | { granted: false; alreadyGranted: true; balance: number };

/**
 * SNS シェアによるポイント付与。
 *  - 1 プラットフォーム 1 日 1 回まで (userId+date+platform のユニーク制約)。
 */
export async function grantSocialShare(
  userId: string,
  platform: SocialPlatformLiteral,
  rates: PointRateSettings,
  now: Date = new Date(),
): Promise<SocialShareResult> {
  const today = jstDateKey(now);

  const existing = await prisma.socialShareGrant.findUnique({
    where: { userId_date_platform: { userId, date: today, platform } },
  });
  if (existing) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { points: true },
    });
    return { granted: false, alreadyGranted: true, balance: u?.points ?? 0 };
  }

  try {
    const { amount, balance } = await prisma.$transaction(async (tx) => {
      // プラン別のポイント付与率を適用 (FREE ×1.0 / STANDARD ×1.2 / PREMIUM ×2.0)
      const plan = await getUserPlanTx(tx, userId);
      const amount = applyPlanPointMultiplier(rates.socialSharePoints, plan);

      await tx.socialShareGrant.create({
        data: { userId, date: today, platform, amount },
      });
      // レートが 0pt のときは付与記録のみ残し、ポイント取引はスキップ。
      if (amount <= 0) {
        const u = await tx.user.findUnique({
          where: { id: userId },
          select: { points: true },
        });
        return { amount, balance: u?.points ?? 0 };
      }
      const bal = await applyPoints(tx, { userId, amount, reason: 'SOCIAL_SHARE' });
      return { amount, balance: bal };
    });
    return { granted: true, amount, balance, alreadyGranted: false };
  } catch (e) {
    if (isUniqueViolation(e)) {
      const u = await prisma.user.findUnique({
        where: { id: userId },
        select: { points: true },
      });
      return { granted: false, alreadyGranted: true, balance: u?.points ?? 0 };
    }
    throw e;
  }
}

/**
 * 管理者によるポイント手動調整。amount は正負どちらも可。
 *  - 調整によって残高がマイナスになる場合は PointIntegrityError を投げ、
 *    トランザクションをロールバックする (残高は常に 0 以上を保証)。
 *  - 監査ログは呼び出し側 (API) で記録する。
 */
export async function adminAdjustPoints(
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
    throw new PointIntegrityError('対象ユーザーが見つかりません');
  }
  return prisma.$transaction((tx) =>
    applyPoints(tx, { userId, amount, reason: 'ADMIN_ADJUST', note }),
  );
}

// ---------------------------------------------------------------------
// Fan ポイントでの恋愛ADV購入 (章 / アイテム)
// ---------------------------------------------------------------------

export type FanPointGamePurchaseResult =
  | { ok: true; balance: number; purchaseId: string }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_FOR_SALE' | 'ALREADY_OWNED' | 'OWN_LIMIT_EXCEEDED' };

/**
 * 恋愛ADVの章 (GameScenario) を Fan ポイントで購入する。
 *  - fanPointPrice が null/0 の章は Fan ポイント購入不可。
 *  - 既に所持していれば ALREADY_OWNED。
 *  - Fan ポイント残高不足時は applyPoints が PointIntegrityError を投げ、
 *    トランザクション全体 (購入記録・所持追加を含む) がロールバックされる。
 */
export async function purchaseScenarioWithFanPoints(
  userId: string,
  scenarioId: string,
): Promise<FanPointGamePurchaseResult> {
  return prisma.$transaction(async (tx) => {
    const sc = await tx.gameScenario.findUnique({ where: { id: scenarioId } });
    if (!sc || sc.status !== 'PUBLISHED') return { ok: false, reason: 'NOT_FOUND' };
    if (!sc.fanPointPrice || sc.fanPointPrice <= 0) {
      return { ok: false, reason: 'NOT_FOR_SALE' };
    }
    const owned = await tx.playerInventory.findUnique({
      where: { userId_scenarioId: { userId, scenarioId: sc.id } },
    });
    if (owned) return { ok: false, reason: 'ALREADY_OWNED' };

    const balance = await applyPoints(tx, {
      userId,
      amount: -sc.fanPointPrice,
      reason: 'ITEM_PURCHASE',
      note: `${sc.title} を Fan ポイントで購入`,
    });

    const purchase = await tx.playerPurchase.create({
      data: {
        userId,
        kind: 'SCENARIO',
        scenarioId: sc.id,
        quantity: 1,
        payMethod: 'FAN_POINT',
        amountJpy: 0,
        fanPointAmount: sc.fanPointPrice,
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
 * 恋愛ADVのアイテム (GameItem) を Fan ポイントで購入する。
 *  - fanPointPrice が null/0 のアイテムは Fan ポイント購入不可。
 *  - maxOwn (所持上限) を超える場合は OWN_LIMIT_EXCEEDED。
 */
export async function purchaseItemWithFanPoints(
  userId: string,
  itemId: string,
  quantity: number,
): Promise<FanPointGamePurchaseResult> {
  return prisma.$transaction(async (tx) => {
    const it = await tx.gameItem.findUnique({ where: { id: itemId } });
    if (!it || !it.isActive) return { ok: false, reason: 'NOT_FOUND' };
    if (!it.fanPointPrice || it.fanPointPrice <= 0) {
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

    const totalCost = it.fanPointPrice * quantity;
    const balance = await applyPoints(tx, {
      userId,
      amount: -totalCost,
      reason: 'ITEM_PURCHASE',
      note: `${it.name} × ${quantity} を Fan ポイントで購入`,
    });

    const purchase = await tx.playerPurchase.create({
      data: {
        userId,
        kind: 'ITEM',
        itemId: it.id,
        quantity,
        payMethod: 'FAN_POINT',
        amountJpy: 0,
        fanPointAmount: totalCost,
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
// 整合性検証 / 異常検知 (管理者がポイントの不正・バグを監視するための土台)
// ---------------------------------------------------------------------

export type PointIntegrityRow = {
  userId: string;
  email: string | null;
  memberNumber: string | null;
  /** User.points に記録された残高 */
  storedBalance: number;
  /** PointTransaction.amount の合計 (本来あるべき残高) */
  ledgerSum: number;
  /** storedBalance - ledgerSum。0 以外なら不整合 */
  diff: number;
  /** 取引件数 */
  txCount: number;
};

/**
 * 全ユーザーについて「User.points」と「PointTransaction の合計」を突き合わせ、
 * 不整合 (diff !== 0) または残高がマイナスのユーザーを返す。
 *
 * これにより、バグ・不正・手動 DB 改変などで残高が台帳とズレた場合に
 * 管理者が検知できる。台帳 (PointTransaction) を信頼の基点とする。
 */
export async function findPointAnomalies(): Promise<PointIntegrityRow[]> {
  // 台帳の合計をユーザー単位で集計
  const sums = await prisma.pointTransaction.groupBy({
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
        { points: { not: 0 } },
        { id: { in: Array.from(ledgerByUser.keys()) } },
      ],
    },
    select: { id: true, email: true, memberNumber: true, points: true },
  });

  const anomalies: PointIntegrityRow[] = [];
  for (const u of users) {
    const ledger = ledgerByUser.get(u.id) ?? { sum: 0, count: 0 };
    const diff = u.points - ledger.sum;
    if (diff !== 0 || u.points < 0) {
      anomalies.push({
        userId: u.id,
        email: u.email,
        memberNumber: u.memberNumber,
        storedBalance: u.points,
        ledgerSum: ledger.sum,
        diff,
        txCount: ledger.count,
      });
    }
  }
  // 台帳にだけ存在しユーザーが集計対象外だったケース (points===0 だが ledgerSum!==0)
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
export async function verifyUserPointsIntegrity(
  userId: string,
): Promise<{ ok: boolean; storedBalance: number; ledgerSum: number; diff: number }> {
  const [user, agg] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
    prisma.pointTransaction.aggregate({
      where: { userId },
      _sum: { amount: true },
    }),
  ]);
  const storedBalance = user?.points ?? 0;
  const ledgerSum = agg._sum.amount ?? 0;
  const diff = storedBalance - ledgerSum;
  return { ok: diff === 0 && storedBalance >= 0, storedBalance, ledgerSum, diff };
}

/**
 * 不整合を台帳 (PointTransaction) 基準で是正する (管理者操作)。
 *
 * 台帳を信頼の基点とし、User.points を台帳合計に一致させる。
 * 台帳自体は正しい前提なので新たな取引は作らず、残高スナップショットのみ修正する。
 * 監査ログは呼び出し側 (API) で記録する。
 */
export async function reconcileUserPoints(
  userId: string,
): Promise<{ before: number; after: number; diff: number }> {
  return prisma.$transaction(async (tx) => {
    const [user, agg] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { points: true } }),
      tx.pointTransaction.aggregate({ where: { userId }, _sum: { amount: true } }),
    ]);
    if (!user) throw new PointIntegrityError('対象ユーザーが見つかりません');
    const before = user.points;
    const ledgerSum = agg._sum.amount ?? 0;

    if (before !== ledgerSum) {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { points: ledgerSum },
        select: { points: true },
      });
      return { before, after: updated.points, diff: ledgerSum - before };
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
 *    競合」が起こり得る。→ 上限を超えたプレイ = 無料報酬 (Fan/特典ポイント) の
 *    超過付与という不正が成立してしまう。
 *  - 追加プレイ購入 (buyAcchiExtraPlay) も同様に、並列だと購入上限
 *    (MAX_EXTRA_PLAYS_PER_DAY) を超えて購入 (=Fan ポイント多重消費) され得る。
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
  const key1 = hashStringToInt32(userId);
  const key2 = hashStringToInt32(scope);
  await client.$executeRaw`SELECT pg_advisory_xact_lock(${key1}::int, ${key2}::int)`;
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
 * @param client prisma もしくはトランザクションクライアント
 */
export async function safeGetPromoUntil(
  client: Pick<typeof prisma, '$queryRaw'>,
  userId: string,
): Promise<Date | null> {
  try {
    const rows = await client.$queryRaw<Array<{ promo_until: Date | null }>>(
      Prisma.sql`SELECT "promo_until" FROM "users" WHERE "id" = ${userId} LIMIT 1`,
    );
    return rows[0]?.promo_until ?? null;
  } catch (e) {
    // カラム未追加 (マイグレーション未適用) 等。プロモ無効として扱う。
    console.error('[safeGetPromoUntil] failed (treating as non-promo)', e);
    return null;
  }
}

export type AcchiPlayPersistResult = {
  /** 受理されたか (回数上限に達していれば false) */
  accepted: boolean;
  /** 受理時に作成された MiniGamePlay の id (拒否時は undefined)。2段階フローの進行トークンで使う。 */
  playId?: string;
  /** プロモ/デモアカウントとしてプレイされたか (true なら回数無制限)。 */
  promoActive: boolean;
  /** ゲーム結果 (受理時のみ意味を持つ) */
  result: AcchiResult;
  /** 付与ポイント (勝利時のみ > 0) */
  reward: number;
  /** プレイ後の残高 (Fan ポイント) */
  balance: number;
  /** プレイ後の本日プレイ回数 */
  playedToday: number;
  /** プレイ後の本日残り回数 (Fan ポイント購入分の追加回数を含む) */
  remaining: number;
  /** 本日の上限回数 (標準上限 + Fan ポイント購入分) */
  maxPerDay: number;
  /** 今回のプレイで付与された特典ポイント (勝利時、かつ本日上限内のみ > 0) */
  rewardPointBonus: number;
  /** プレイ後の特典ポイント残高 */
  rewardPointBalance: number;
  /** 本日 (JST) 付与済みの特典ポイント合計 (このプレイ分を含む) */
  rewardPointGrantedToday: number;
  /** 本日 (JST) 付与できる特典ポイントの上限 */
  rewardPointDailyCap: number;
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
 * 本日、Fan ポイントで購入済みの追加プレイ回数を取得する (JST 基準)。
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
 * 本日 (JST) 既に付与済みの特典ポイントボーナス合計を取得する。
 * GET (状況表示) 用。実際の上限チェックは recordAcchiPlay 内でトランザクション内に行う。
 */
export async function getAcchiRewardBonusGrantedToday(
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const date = jstDateKey(now);
  const agg = await prisma.miniGamePlay.aggregate({
    where: { userId, gameType: 'ACCHI_MUITE_HOI', date },
    _sum: { bonusRewardPoint: true },
  });
  return agg._sum.bonusRewardPoint ?? 0;
}

/**
 * 本日の実効上限 (標準上限 + Fan ポイント購入分) を取得する。
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
 *    クライアントから結果やポイントを直接受け取らない (改ざん不可)。
 *  - 「1 日 N 回まで」の上限チェック、プレイ記録の作成、ポイント付与を
 *    すべて同一トランザクション内で実行し、cluster 並列でも超過付与を防ぐ。
 *  - 上限は「標準上限 (ACCHI_MAX_PLAYS_PER_DAY) + Fan ポイントで購入した追加回数」。
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
  rewardBonusSettings: AcchiRewardBonusSettings = DEFAULT_ACCHI_REWARD_BONUS_SETTINGS,
): Promise<AcchiPlayPersistResult> {
  const date = jstDateKey(now);

  return prisma.$transaction(async (tx) => {
    // 【競合対策】同一ユーザー・同一ゲームの「上限チェック → 記録」を直列化する。
    // これがないと READ COMMITTED 下で並列リクエストが同じ count を読み、
    // 両方が上限判定を通過して上限超過プレイ (無料報酬の超過付与) が成立し得る。
    await acquireUserGameLock(tx, userId, 'ACCHI_MUITE_HOI:play');

    // プラン別のポイント付与率を適用 (FREE ×1.0 / STANDARD ×1.2 / PREMIUM ×2.0)
    const plan = await getUserPlanTx(tx, userId);
    const reward =
      result === 'WIN' ? applyPlanPointMultiplier(ACCHI_WIN_REWARD, plan) : 0;

    // トランザクション内で当日プレイ数・Fan ポイント購入済み追加回数・
    // 本日付与済みの特典ポイント合計を数え、上限チェック (競合に強い)。
    // プロモ/デモアカウント判定用に promoUntil も同時取得する。
    const [playedBefore, extraRow, bonusAgg, promoUntil] = await Promise.all([
      tx.miniGamePlay.count({ where: { userId, gameType: 'ACCHI_MUITE_HOI', date } }),
      tx.miniGameExtraPlayPurchase.findUnique({
        where: { userId_gameType_date: { userId, gameType: 'ACCHI_MUITE_HOI', date } },
      }),
      tx.miniGamePlay.aggregate({
        where: { userId, gameType: 'ACCHI_MUITE_HOI', date },
        _sum: { bonusRewardPoint: true },
      }),
      // promo_until はカラム未追加でも 500 にしないよう安全に読む (未追加なら null)。
      safeGetPromoUntil(tx, userId),
    ]);
    // プロモ/デモアカウントは 1 日の回数上限を撤廃する (何度でもプレイ可能)。
    const promoActive = isPromoActive(promoUntil, now);
    const maxPerDay = ACCHI_MAX_PLAYS_PER_DAY + (extraRow?.purchasedCount ?? 0);
    const rewardPointGrantedBefore = bonusAgg._sum.bonusRewardPoint ?? 0;
    const rewardPointDailyCap = rewardBonusSettings.dailyCap;

    if (!promoActive && playedBefore >= maxPerDay) {
      const u = await tx.user.findUnique({
        where: { id: userId },
        select: { points: true, rewardPoints: true },
      });
      return {
        accepted: false,
        promoActive: false,
        result,
        reward: 0,
        balance: u?.points ?? 0,
        playedToday: playedBefore,
        remaining: 0,
        maxPerDay,
        rewardPointBonus: 0,
        rewardPointBalance: u?.rewardPoints ?? 0,
        rewardPointGrantedToday: rewardPointGrantedBefore,
        rewardPointDailyCap,
      };
    }

    // 「薄い還元率 + 1日上限」の特典ポイントボーナスを計算する (純粋関数)。
    // Fan ポイントは無料で貯まるため、そのまま特典ポイントに交換されないよう
    // ここで厳しく絞る (勝利時のみ・1日上限あり)。
    const rewardPointBonus = computeAcchiRewardBonus(
      result,
      rewardPointGrantedBefore,
      rewardBonusSettings,
    );

    const createdPlay = await tx.miniGamePlay.create({
      data: {
        userId,
        gameType: 'ACCHI_MUITE_HOI',
        date,
        result,
        rewardPoint: reward,
        bonusRewardPoint: rewardPointBonus,
        detail: detail ?? null,
      },
      select: { id: true },
    });

    let balance: number;
    if (reward > 0) {
      balance = await applyPoints(tx, {
        userId,
        amount: reward,
        reason: 'GAME_REWARD',
        note: 'あっちむいてPUI 勝利報酬',
      });
    } else {
      const u = await tx.user.findUnique({
        where: { id: userId },
        select: { points: true },
      });
      balance = u?.points ?? 0;
    }

    let rewardPointBalance: number;
    if (rewardPointBonus > 0) {
      rewardPointBalance = await applyRewardPoints(tx, {
        userId,
        amount: rewardPointBonus,
        reason: 'GAME_REWARD',
        note: 'あっちむいてPUI 勝利ボーナス (特典ポイント)',
      });
    } else {
      const u = await tx.user.findUnique({
        where: { id: userId },
        select: { rewardPoints: true },
      });
      rewardPointBalance = u?.rewardPoints ?? 0;
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
      rewardPointBonus,
      rewardPointBalance,
      rewardPointGrantedToday: rewardPointGrantedBefore + rewardPointBonus,
      rewardPointDailyCap,
    };
  });
}

export type BuyExtraPlayResult =
  | { ok: true; balance: number; purchasedToday: number; maxPerDay: number }
  | { ok: false; reason: 'LIMIT_REACHED' };

/**
 * ミニゲーム (あっちむいてPUI) の追加プレイ回数を Fan ポイントで購入する。
 *  - 1 日に購入できる追加回数には上限がある (MAX_EXTRA_PLAYS_PER_DAY)。
 *  - Fan ポイント残高不足時は applyPoints が PointIntegrityError を投げ、
 *    トランザクション全体 (購入回数の加算を含む) がロールバックされる。
 */
export async function buyAcchiExtraPlay(
  userId: string,
  now: Date = new Date(),
): Promise<BuyExtraPlayResult> {
  const date = jstDateKey(now);

  return prisma.$transaction(async (tx) => {
    // 【競合対策】追加プレイ購入も並列だと購入上限を超えて購入 (Fan ポイント多重消費)
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

    const balance = await applyPoints(tx, {
      userId,
      amount: -EXTRA_PLAY_COST_FAN_POINTS,
      reason: 'EXTRA_PLAY_PURCHASE',
      note: 'あっちむいてPUI 追加プレイ購入',
    });

    if (existing) {
      await tx.miniGameExtraPlayPurchase.update({
        where: { id: existing.id },
        data: {
          purchasedCount: { increment: 1 },
          totalFanPointsSpent: { increment: EXTRA_PLAY_COST_FAN_POINTS },
        },
      });
    } else {
      await tx.miniGameExtraPlayPurchase.create({
        data: {
          userId,
          gameType: 'ACCHI_MUITE_HOI',
          date,
          purchasedCount: 1,
          totalFanPointsSpent: EXTRA_PLAY_COST_FAN_POINTS,
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
// 特典ポイント (Reward Point) — 課金 / 会員特典で貯まり、景品交換に使う
// ---------------------------------------------------------------------

/**
 * 特典ポイントを増減し、履歴を残す (内部用)。残高を返す。
 * tx を渡せば既存トランザクションに参加する。applyPoints (Fan ポイント用) と
 * 同じ不変条件 (整数 / 非ゼロ / 上限内 / マイナス残高禁止) を適用する。
 */
async function applyRewardPoints(
  client: Prisma.TransactionClient,
  params: {
    userId: string;
    amount: number;
    reason: RewardPointReasonLiteral;
    note?: string;
    allowNegative?: boolean;
  },
): Promise<number> {
  if (!isValidPointAmount(params.amount)) {
    if (!Number.isInteger(params.amount)) {
      throw new PointIntegrityError('特典ポイントは整数で指定してください');
    }
    if (params.amount === 0) {
      throw new PointIntegrityError('0 特典ポイントの取引は記録できません');
    }
    throw new PointIntegrityError(
      `1 取引で動かせる特典ポイントは ±${MAX_POINTS_PER_TX} までです`,
    );
  }

  const user = await client.user.update({
    where: { id: params.userId },
    data: { rewardPoints: { increment: params.amount } },
    select: { rewardPoints: true },
  });

  if (!params.allowNegative && user.rewardPoints < 0) {
    throw new PointIntegrityError('特典ポイント残高が不足しています');
  }

  await client.rewardPointTransaction.create({
    data: {
      userId: params.userId,
      amount: params.amount,
      balance: user.rewardPoints,
      reason: params.reason,
      note: params.note ?? null,
    },
  });
  return user.rewardPoints;
}

/**
 * 管理者による特典ポイント手動調整。amount は正負どちらも可。
 */
export async function adminAdjustRewardPoints(
  userId: string,
  amount: number,
  note?: string,
): Promise<number> {
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!target) throw new PointIntegrityError('対象ユーザーが見つかりません');
  return prisma.$transaction((tx) =>
    applyRewardPoints(tx, { userId, amount, reason: 'ADMIN_ADJUST', note }),
  );
}

export type RewardPointPurchaseConfirmResult =
  | { ok: true; balance: number }
  | { ok: false; reason: 'NOT_FOUND' | 'ALREADY_PROCESSED' };

/**
 * Stripe 決済確定 (webhook) を受けて特典ポイントを付与する。
 *  - RewardPointPurchase.status が既に SUCCEEDED なら二重付与しない。
 *  - purchaseId は RewardPointPurchase.id (checkout 作成時に発行済み)。
 */
export async function grantRewardPointsFromStripePurchase(
  purchaseId: string,
  opts?: { stripePaymentIntentId?: string | null },
): Promise<RewardPointPurchaseConfirmResult> {
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

    const balance = await applyRewardPoints(tx, {
      userId: purchase.userId,
      amount: purchase.points,
      reason: 'STRIPE_PURCHASE',
      note: `特典ポイントパック購入 (${purchase.points}pt / ¥${purchase.amountJpy.toLocaleString()})`,
    });

    return { ok: true, balance };
  });
}

export type MonthlyRewardPointGrantResult =
  | { granted: true; amount: number; balance: number }
  | { granted: false; reason: 'NO_BONUS_FOR_PLAN' | 'ALREADY_GRANTED' };

/**
 * サブスクプランに応じた月次特典ポイントを自動付与する。
 *  - MonthlyRewardPointGrant (userId, yearMonth) のユニーク制約で二重付与を防止。
 *  - FREE プランは付与額 0 のため NO_BONUS_FOR_PLAN を返す。
 */
export async function grantMonthlyRewardPointBonus(
  userId: string,
  plan: PlanTypeLiteral,
  yearMonth: string,
): Promise<MonthlyRewardPointGrantResult> {
  const amount = MONTHLY_REWARD_POINT_BONUS[plan] ?? 0;
  if (amount <= 0) return { granted: false, reason: 'NO_BONUS_FOR_PLAN' };

  try {
    const balance = await prisma.$transaction(async (tx) => {
      const existing = await tx.monthlyRewardPointGrant.findUnique({
        where: { userId_yearMonth: { userId, yearMonth } },
      });
      if (existing) throw new Error('ALREADY_GRANTED');

      await tx.monthlyRewardPointGrant.create({
        data: { userId, yearMonth, plan, points: amount },
      });

      return applyRewardPoints(tx, {
        userId,
        amount,
        reason: 'SUBSCRIPTION_BONUS',
        note: `${plan} プラン ${yearMonth} 月次特典ポイント`,
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
 * 景品カタログ交換 (特典ポイント消費)。
 *  - stock が設定されている場合は在庫を原子的にデクリメントする。
 *  - GOODS (発送必要) は配送先情報が必須。
 *  - 特典ポイント残高不足時は applyRewardPoints が PointIntegrityError を投げ、
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

    const balance = await applyRewardPoints(tx, {
      userId,
      amount: -item.pointCost,
      reason: 'REDEMPTION',
      note: `${item.name} と交換`,
    });

    const redemption = await tx.rewardRedemption.create({
      data: {
        userId,
        catalogItemId: item.id,
        itemName: item.name,
        itemKind: item.kind,
        pointCost: item.pointCost,
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
 *  - CANCELED へ遷移する場合は特典ポイントを返還する (REFUND)。
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

    // キャンセル時は特典ポイントを返還する
    if (next === 'CANCELED') {
      await applyRewardPoints(tx, {
        userId: redemption.userId,
        amount: redemption.pointCost,
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
