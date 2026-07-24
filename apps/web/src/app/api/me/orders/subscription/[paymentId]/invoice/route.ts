/**
 * GET /api/me/orders/subscription/[paymentId]/invoice
 *   - 自分のサブスクリプション課金 (Payment kind=SUBSCRIPTION) の
 *     「支払明細書」を PDF でダウンロードする。
 *   - 他人の Payment ID を推測してアクセスされても、存在有無を漏らさないよう
 *     常に 404 (Not Found) を返す (EC 注文側の invoice ルートと同じ方針)。
 *   - PDF の組み立ては共通レンダラ (@/lib/invoice-pdf) に委譲する。
 */
import { prisma } from '@idol/db';
import { requireApiSession } from '@/lib/api-auth';
import { handle, errors } from '@/lib/errors';
import { PAYMENT_STATUS_LABELS, PLAN_LABELS, type PlanTypeLiteral } from '@idol/shared';
import { renderInvoicePdf, type InvoiceDocument } from '@/lib/invoice-pdf';

export const runtime = 'nodejs';

function billingIntervalLabel(interval: 'MONTH' | 'YEAR' | null | undefined): string {
  return interval === 'YEAR' ? '年額' : '月額';
}

function buildSubscriptionInvoiceDocument(payment: {
  id: string;
  status: string;
  amount: number;
  createdAt: Date;
  stripeInvoiceId: string | null;
  subscription: {
    planType: string;
    billingInterval: 'MONTH' | 'YEAR';
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
  } | null;
}): InvoiceDocument {
  const statusLabel =
    PAYMENT_STATUS_LABELS[payment.status as keyof typeof PAYMENT_STATUS_LABELS] ?? payment.status;
  const planType = (payment.subscription?.planType ?? 'STANDARD') as PlanTypeLiteral;
  const planLabel = PLAN_LABELS[planType] ?? planType;
  const intervalLabel = billingIntervalLabel(payment.subscription?.billingInterval);
  // 決済成功時のみ「お支払い日」とみなす (失敗・処理中は課金発生日時のみ表示)
  const paidAt = payment.status === 'SUCCEEDED' ? payment.createdAt : null;

  const periodLabel =
    payment.subscription != null
      ? `対象期間: ${payment.subscription.currentPeriodStart.toLocaleDateString('ja-JP')} 〜 ${payment.subscription.currentPeriodEnd.toLocaleDateString('ja-JP')}`
      : undefined;

  return {
    title: '支払明細書',
    documentNumberLabel: '決済番号',
    // Stripe Invoice ID があればそれを、無ければ Payment.id (先頭8桁) を表示する
    documentNumber: payment.stripeInvoiceId ?? payment.id.slice(0, 8).toUpperCase(),
    occurredAtLabel: 'お申込み日',
    occurredAt: payment.createdAt,
    paidAt,
    statusLabel,
    itemsSectionTitle: 'お申込み内容',
    items: [
      {
        label: `${planLabel} プラン`,
        detail: periodLabel ?? intervalLabel,
        subtotal: payment.amount,
      },
    ],
    summary: [{ label: '合計', amount: payment.amount, bold: true }],
  };
}

export const GET = handle(
  async (req: Request, ctx: { params: Promise<{ paymentId: string }> }) => {
    const session = await requireApiSession(req);
    const { paymentId } = await ctx.params;

    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        userId: true,
        kind: true,
        status: true,
        amount: true,
        createdAt: true,
        stripeInvoiceId: true,
        subscription: {
          select: {
            planType: true,
            billingInterval: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
          },
        },
      },
    });

    // 他人の決済・サブスク以外の決済は見せない (存在有無も漏らさないよう 404 に統一)
    if (!payment || payment.userId !== session.user.id || payment.kind !== 'SUBSCRIPTION') {
      throw errors.notFound();
    }

    const pdfBuffer = await renderInvoicePdf(buildSubscriptionInvoiceDocument(payment));
    const filename = `invoice-subscription-${payment.id.slice(0, 8)}.pdf`;

    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'Content-Length': String(pdfBuffer.length),
      },
    });
  },
);
