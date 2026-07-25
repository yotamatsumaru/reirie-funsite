/**
 * マイページの「購入履歴」に表示する、EC 注文 (Order) と
 * サブスクリプション課金 (Payment kind=SUBSCRIPTION) を統合したフィードのヘルパ。
 *
 * これまで /me/orders はグッズ注文 (Order) のみを表示していたが、
 * サブスク (プラン) の課金履歴もここに含めたいという要望に対応する。
 * Order と Payment(SUBSCRIPTION) はテーブルが異なるため、
 * 表示用に共通の型 (UnifiedHistoryEntry) へ正規化してから日付順にマージする。
 */
import { prisma } from '@idol/db';
import { PLAN_LABELS, type PlanTypeLiteral } from '@idol/shared';

export type UnifiedHistoryEntry =
  | {
      type: 'ORDER';
      id: string;
      createdAt: Date;
      amount: number;
      /** 注文番号 (例: ORD-XXXX) */
      documentNumber: string;
      /** 一覧表示用のステータス文字列 (Order.status) */
      status: string;
      /** 一覧に出す商品名の要約 (先頭2件 + 他n点) */
      summaryLabel: string;
    }
  | {
      type: 'SUBSCRIPTION_PAYMENT';
      /** Payment.id (詳細/PDF ダウンロードのキーとして使う) */
      id: string;
      createdAt: Date;
      amount: number;
      /** 一覧表示用のステータス文字列 (Payment.status) */
      status: string;
      /** プラン名 (例: 'スタンダード')。サブスク行に紐づかない場合は null。 */
      planLabel: string | null;
      /** 課金サイクル (例: '月額' / '年額')。不明な場合は null。 */
      intervalLabel: string | null;
    };

function billingIntervalLabel(interval: 'MONTH' | 'YEAR' | null | undefined): string | null {
  if (interval === 'YEAR') return '年額';
  if (interval === 'MONTH') return '月額';
  // 不明なときに '月額' を既定にすると、年額プランが「月額」と誤表示されるため null を返す。
  return null;
}

/**
 * 指定ユーザーの「EC 注文」+「サブスク課金」を統合し、新しい順に並べて返す。
 *
 * @param userId 対象ユーザー ID
 * @param limit  取得する最大件数 (Order/Payment それぞれに適用したうえで
 *               マージ後に再度 limit で切る。極端に偏った履歴でも一覧が
 *               片方に独占されないよう、まず両方から limit 件ずつ取得する)
 */
export async function getUnifiedOrderHistory(
  userId: string,
  limit = 100,
): Promise<UnifiedHistoryEntry[]> {
  const [orders, payments] = await Promise.all([
    prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        items: { select: { productName: true } },
      },
    }),
    prisma.payment.findMany({
      where: { userId, kind: 'SUBSCRIPTION' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        status: true,
        amount: true,
        createdAt: true,
        subscription: { select: { planType: true, billingInterval: true } },
      },
    }),
  ]);

  const orderEntries: UnifiedHistoryEntry[] = orders.map((o) => {
    const names = o.items.map((it) => it.productName);
    const summaryLabel =
      names.slice(0, 2).join(' / ') + (names.length > 2 ? ` 他${names.length - 2}点` : '');
    return {
      type: 'ORDER',
      id: o.id,
      createdAt: o.createdAt,
      amount: o.totalAmount,
      documentNumber: o.orderNumber,
      status: o.status,
      summaryLabel,
    };
  });

  const paymentEntries: UnifiedHistoryEntry[] = payments.map((p) => {
    // サブスク行に紐づかない (Webhook 取りこぼし等) 場合は、誤ったプラン名を出さないよう
    // null にしておき、表示側で「サブスクリプション」等の中立ラベルにフォールバックさせる。
    const planType = (p.subscription?.planType ?? null) as PlanTypeLiteral | null;
    return {
      type: 'SUBSCRIPTION_PAYMENT',
      id: p.id,
      createdAt: p.createdAt,
      amount: p.amount,
      status: p.status,
      planLabel: planType ? (PLAN_LABELS[planType] ?? planType) : null,
      intervalLabel: billingIntervalLabel(p.subscription?.billingInterval),
    };
  });

  return [...orderEntries, ...paymentEntries]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}
