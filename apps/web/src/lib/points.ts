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
 */
async function applyPoints(
  client: Prisma.TransactionClient,
  params: { userId: string; amount: number; reason: PointReasonLiteral; note?: string },
): Promise<number> {
  const user = await client.user.update({
    where: { id: params.userId },
    data: { points: { increment: params.amount } },
    select: { points: true },
  });
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

  // 前日の付与記録から streak を算出
  const yesterday = previousJstDateKey(today);
  const yGrant = await prisma.loginBonusGrant.findUnique({
    where: { userId_date: { userId, date: yesterday } },
    select: { streak: true },
  });
  const streak = (yGrant?.streak ?? 0) + 1;
  const amount = computeLoginBonusAmount(streak, rates);

  try {
    const balance = await prisma.$transaction(async (tx) => {
      // ユニーク制約 (userId+date) で二重付与を防止
      await tx.loginBonusGrant.create({
        data: { userId, date: today, streak, amount },
      });
      // 連続ボーナスが乗っている場合は理由を分けて記録すると分かりやすいが、
      // ここでは合算で 1 取引として記録する。
      return applyPoints(tx, {
        userId,
        amount,
        reason: amount > rates.loginBonusBase ? 'LOGIN_STREAK' : 'LOGIN_BONUS',
      });
    });
    return { granted: true, amount, streak, balance, alreadyGranted: false };
  } catch (e) {
    // 競合で同時に付与された場合 → 既付与として扱う
    if (isUniqueViolation(e)) {
      const u = await prisma.user.findUnique({
        where: { id: userId },
        select: { points: true },
      });
      return {
        granted: false,
        alreadyGranted: true,
        streak,
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
 */
export async function adminAdjustPoints(
  userId: string,
  amount: number,
  note?: string,
): Promise<number> {
  return prisma.$transaction((tx) =>
    applyPoints(tx, { userId, amount, reason: 'ADMIN_ADJUST', note }),
  );
}
