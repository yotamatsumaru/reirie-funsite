/**
 * GET /api/me/orders/[id]/invoice
 *   - 自分の注文の「支払明細書」を PDF でダウンロードする。
 *   - 他人の注文 ID を推測してアクセスされても、存在有無を漏らさないよう
 *     常に 404 (Not Found) を返す (ページ側 `notFound()` と同じ方針)。
 *   - PDF の組み立ては共通レンダラ (@/lib/invoice-pdf) に委譲する。
 *     サブスク課金の明細書 (/api/me/orders/subscription/[paymentId]/invoice) も
 *     同じレンダラを使っており、レイアウトの一貫性を保っている。
 */
import { prisma } from '@idol/db';
import { requireApiSession } from '@/lib/api-auth';
import { handle, errors } from '@/lib/errors';
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@idol/shared';
import { renderInvoicePdf, type InvoiceDocument } from '@/lib/invoice-pdf';

export const runtime = 'nodejs';

function buildOrderInvoiceDocument(order: {
  orderNumber: string;
  status: string;
  createdAt: Date;
  paidAt: Date | null;
  subtotal: number;
  taxAmount: number;
  shippingFee: number;
  discountAmount: number;
  totalAmount: number;
  shippingName: string;
  shippingPostalCode: string;
  shippingPrefecture: string;
  shippingAddress1: string;
  shippingAddress2: string | null;
  items: { productName: string; variantName: string; quantity: number; unitPrice: number; subtotal: number }[];
  payments: { status: string; amount: number; createdAt: Date }[];
}): InvoiceDocument {
  const statusLabel =
    ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS] ?? order.status;

  return {
    title: '支払明細書',
    documentNumberLabel: '注文番号',
    documentNumber: order.orderNumber,
    occurredAtLabel: 'ご注文日',
    occurredAt: order.createdAt,
    paidAt: order.paidAt,
    statusLabel,
    billTo: {
      name: order.shippingName,
      postalCode: order.shippingPostalCode,
      prefecture: order.shippingPrefecture,
      address1: order.shippingAddress1,
      address2: order.shippingAddress2,
    },
    itemsSectionTitle: 'ご注文内容',
    items: order.items.map((it) => ({
      label: it.productName,
      detail: it.variantName,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      subtotal: it.subtotal,
    })),
    summary: [
      { label: '小計', amount: order.subtotal },
      { label: '消費税', amount: order.taxAmount },
      { label: '配送料', amount: order.shippingFee },
      ...(order.discountAmount > 0
        ? [{ label: '割引', amount: order.discountAmount, negative: true }]
        : []),
      { label: '合計', amount: order.totalAmount, bold: true },
    ],
    paymentHistorySectionTitle: '決済履歴',
    paymentHistory: order.payments.map((p) => ({
      createdAt: p.createdAt,
      statusLabel: PAYMENT_STATUS_LABELS[p.status as keyof typeof PAYMENT_STATUS_LABELS] ?? p.status,
      amount: p.amount,
    })),
  };
}

export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireApiSession(req);
  const { id } = await ctx.params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: {
        select: { productName: true, variantName: true, quantity: true, unitPrice: true, subtotal: true },
      },
      payments: {
        orderBy: { createdAt: 'desc' },
        select: { status: true, amount: true, createdAt: true },
      },
    },
  });

  // 他人の注文は見せない (存在有無も漏らさないよう 404 に統一)
  if (!order || order.userId !== session.user.id) {
    throw errors.notFound();
  }

  const pdfBuffer = await renderInvoicePdf(buildOrderInvoiceDocument(order));
  const filename = `invoice-${order.orderNumber}.pdf`;

  return new Response(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      'Content-Length': String(pdfBuffer.length),
    },
  });
});
