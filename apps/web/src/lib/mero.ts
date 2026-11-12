/**
 * Mero (Pui の上位ポイント) のサービス層。
 *
 * 設計は Pui (lib/points.ts) と同じ:
 *  - 残高 (User.mero) は MeroTransaction の合計と一致させる。
 *    付与 / 消費は必ず 1 つの $transaction で「残高インクリメント + 履歴作成」を行う。
 *  - increment は DB 側で原子的に実行されるため、PM2 cluster の並列処理でも競合しない。
 *  - 残高がマイナスになる操作はロールバックする (DB の CHECK 制約でも二重に守っている)。
 *
 * 【現在の状態】非公開 (site.sectionVisibility.meroVisible = false)。
 * 付与経路は管理者の手動付与 (adminAdjustMero) のみ。ライブ特典・物販特典の
 * 自動付与や特典交換は、運用が固まってからこの applyMero を使って追加する想定。
 */
import { prisma, Prisma } from '@idol/db';
import {
  isValidMeroAmount,
  MAX_MERO_PER_TX,
  type MeroReasonLiteral,
} from '@idol/shared';

/** Mero の不正操作 (残高不足・不正な値・対象なし) */
export class MeroIntegrityError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = 'MeroIntegrityError';
  }
}

/**
 * Mero を増減する (トランザクション内専用)。
 * 残高更新と履歴作成を同じトランザクションで行うため、必ず tx を渡すこと。
 *
 * @returns 取引後の残高
 */
export async function applyMero(
  client: Prisma.TransactionClient,
  params: {
    userId: string;
    amount: number;
    reason: MeroReasonLiteral;
    note?: string | null;
    actorId?: string | null;
  },
): Promise<number> {
  if (!isValidMeroAmount(params.amount)) {
    if (!Number.isInteger(params.amount)) {
      throw new MeroIntegrityError('Mero は整数で指定してください');
    }
    if (params.amount === 0) {
      throw new MeroIntegrityError('0 Mero の取引は記録できません');
    }
    throw new MeroIntegrityError(
      `1 回で動かせる Mero は ±${MAX_MERO_PER_TX.toLocaleString('ja-JP')} までです`,
    );
  }

  const user = await client.user.update({
    where: { id: params.userId },
    data: { mero: { increment: params.amount } },
    select: { mero: true },
  });

  if (user.mero < 0) {
    // throw でトランザクション全体がロールバックされ、残高も元に戻る
    throw new MeroIntegrityError(
      `Mero 残高が不足しています (現在 ${(user.mero - params.amount).toLocaleString('ja-JP')} Mero)`,
    );
  }

  await client.meroTransaction.create({
    data: {
      userId: params.userId,
      amount: params.amount,
      balance: user.mero,
      reason: params.reason,
      note: params.note?.trim() || null,
      actorId: params.actorId ?? null,
    },
  });
  return user.mero;
}

/**
 * 管理者による Mero の付与 / 減算。
 *  - amount は正 (付与) / 負 (減算) どちらも可
 *  - 残高がマイナスになる減算は MeroIntegrityError
 *  - 監査ログは呼び出し側 (API) で記録する
 *
 * @returns 取引後の残高
 */
export async function adminAdjustMero(params: {
  userId: string;
  amount: number;
  reason: MeroReasonLiteral;
  note?: string | null;
  actorId: string;
}): Promise<number> {
  // 存在しない userId で update すると Prisma の P2025 になり 500 で返ってしまうため、
  // 先に確認して分かりやすいエラーにする
  const target = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true },
  });
  if (!target) {
    throw new MeroIntegrityError('対象ユーザーが見つかりません');
  }
  return prisma.$transaction((tx) => applyMero(tx, params));
}

/**
 * 会員本人の Mero 残高と直近の履歴を取得する。
 */
export async function getMeroSummary(userId: string, limit = 50) {
  const [user, transactions] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { mero: true } }),
    prisma.meroTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      select: {
        id: true,
        amount: true,
        balance: true,
        reason: true,
        note: true,
        createdAt: true,
      },
    }),
  ]);
  return { balance: user?.mero ?? 0, transactions };
}
