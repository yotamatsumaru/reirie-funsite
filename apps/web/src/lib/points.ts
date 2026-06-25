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
  type PointRateSettings,
  type SocialPlatformLiteral,
} from '@idol/shared';

type PointReasonLiteral =
  | 'LOGIN_BONUS'
  | 'LOGIN_STREAK'
  | 'SOCIAL_SHARE'
  | 'ADMIN_ADJUST'
  | 'SIGNUP_BONUS'
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
      const computedAmount = computeLoginBonusAmount(computedStreak, rates);

      // ユニーク制約 (userId+date) で二重付与を防止
      await tx.loginBonusGrant.create({
        data: { userId, date: today, streak: computedStreak, amount: computedAmount },
      });
      const bal = await applyPoints(tx, {
        userId,
        amount: computedAmount,
        reason: computedAmount > rates.loginBonusBase ? 'LOGIN_STREAK' : 'LOGIN_BONUS',
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
  const amount = rates.socialSharePoints;

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
    const balance = await prisma.$transaction(async (tx) => {
      await tx.socialShareGrant.create({
        data: { userId, date: today, platform, amount },
      });
      // レートが 0pt のときは付与記録のみ残し、ポイント取引はスキップ。
      if (amount <= 0) {
        const u = await tx.user.findUnique({
          where: { id: userId },
          select: { points: true },
        });
        return u?.points ?? 0;
      }
      return applyPoints(tx, { userId, amount, reason: 'SOCIAL_SHARE' });
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
