/**
 * GET /api/me/orders/[id]/invoice
 *   - 自分の注文の「支払明細書」を PDF でダウンロードする。
 *   - 他人の注文 ID を推測してアクセスされても、存在有無を漏らさないよう
 *     常に 404 (Not Found) を返す (ページ側 `notFound()` と同じ方針)。
 *   - pdfkit で日本語 (Noto Sans JP) を埋め込んだ PDF をその場で生成する。
 */
import PDFDocument from 'pdfkit';
import path from 'node:path';
import { prisma } from '@idol/db';
import { requireApiSession } from '@/lib/api-auth';
import { handle, errors } from '@/lib/errors';
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@idol/shared';

export const runtime = 'nodejs';

const FONT_DIR = path.join(process.cwd(), 'src', 'lib', 'fonts');
const FONT_REGULAR = path.join(FONT_DIR, 'NotoSansJP-Regular.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'NotoSansJP-Bold.ttf');

const SITE_NAME = 'ReiRieRoom';

function formatYen(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatDateTime(d: Date): string {
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * pdfkit で支払明細書 (Invoice) の PDF を生成し、Buffer で返す。
 */
async function renderInvoicePdf(order: {
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
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.registerFont('NotoSansJP', FONT_REGULAR);
      doc.registerFont('NotoSansJP-Bold', FONT_BOLD);
      doc.font('NotoSansJP');

      // --- タイトル ---
      doc.font('NotoSansJP-Bold').fontSize(20).text('支払明細書', { align: 'center' });
      doc.moveDown(0.5);
      doc.font('NotoSansJP').fontSize(10).fillColor('#555555').text(SITE_NAME, { align: 'center' });
      doc.fillColor('#000000');
      doc.moveDown(1.5);

      // --- 注文情報 ---
      const statusLabel =
        ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS] ?? order.status;
      doc.fontSize(11);
      doc.text(`注文番号: ${order.orderNumber}`);
      doc.text(`発行日: ${formatDate(new Date())}`);
      doc.text(`ご注文日: ${formatDateTime(order.createdAt)}`);
      if (order.paidAt) {
        doc.text(`お支払い日: ${formatDateTime(order.paidAt)}`);
      }
      doc.text(`注文状況: ${statusLabel}`);
      doc.moveDown(1);

      // --- お届け先 ---
      doc.font('NotoSansJP-Bold').fontSize(12).text('お届け先');
      doc.font('NotoSansJP').fontSize(11);
      doc.text(`${order.shippingName} 様`);
      doc.text(
        `〒${order.shippingPostalCode} ${order.shippingPrefecture}${order.shippingAddress1}${
          order.shippingAddress2 ?? ''
        }`,
      );
      doc.moveDown(1);

      // --- ご注文内容 (表) ---
      doc.font('NotoSansJP-Bold').fontSize(12).text('ご注文内容');
      doc.moveDown(0.3);

      const tableTop = doc.y;
      const colX = { name: 50, qty: 340, unit: 400, subtotal: 470 };
      const rightEdge = 545;

      doc.fontSize(9).font('NotoSansJP-Bold');
      doc.text('商品名', colX.name, tableTop, { width: colX.qty - colX.name - 10 });
      doc.text('数量', colX.qty, tableTop, { width: colX.unit - colX.qty - 10, align: 'right' });
      doc.text('単価', colX.unit, tableTop, { width: colX.subtotal - colX.unit - 10, align: 'right' });
      doc.text('小計', colX.subtotal, tableTop, { width: rightEdge - colX.subtotal, align: 'right' });

      let y = tableTop + 16;
      doc
        .moveTo(colX.name, y - 4)
        .lineTo(rightEdge, y - 4)
        .strokeColor('#cccccc')
        .stroke();

      doc.font('NotoSansJP').fontSize(9);
      for (const item of order.items) {
        const label = `${item.productName} (${item.variantName})`;
        const rowHeight = doc.heightOfString(label, { width: colX.qty - colX.name - 10 }) + 6;

        doc.text(label, colX.name, y, { width: colX.qty - colX.name - 10 });
        doc.text(String(item.quantity), colX.qty, y, {
          width: colX.unit - colX.qty - 10,
          align: 'right',
        });
        doc.text(formatYen(item.unitPrice), colX.unit, y, {
          width: colX.subtotal - colX.unit - 10,
          align: 'right',
        });
        doc.text(formatYen(item.subtotal), colX.subtotal, y, {
          width: rightEdge - colX.subtotal,
          align: 'right',
        });

        y += rowHeight;

        // ページをまたぐ場合は改ページする
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
      }

      doc
        .moveTo(colX.name, y)
        .lineTo(rightEdge, y)
        .strokeColor('#cccccc')
        .stroke();
      y += 12;

      // --- 金額まとめ ---
      const summaryLabelWidth = colX.subtotal - colX.unit - 10;
      const printSummaryRow = (label: string, value: string, bold = false) => {
        doc.font(bold ? 'NotoSansJP-Bold' : 'NotoSansJP').fontSize(bold ? 12 : 10);
        doc.text(label, colX.unit - 60, y, { width: summaryLabelWidth + 60, align: 'right' });
        doc.text(value, colX.subtotal, y, { width: rightEdge - colX.subtotal, align: 'right' });
        y += bold ? 20 : 16;
      };

      printSummaryRow('小計', formatYen(order.subtotal));
      printSummaryRow('消費税', formatYen(order.taxAmount));
      printSummaryRow('配送料', formatYen(order.shippingFee));
      if (order.discountAmount > 0) {
        printSummaryRow('割引', `-${formatYen(order.discountAmount)}`);
      }
      doc
        .moveTo(colX.unit - 60, y - 4)
        .lineTo(rightEdge, y - 4)
        .strokeColor('#333333')
        .stroke();
      printSummaryRow('合計', formatYen(order.totalAmount), true);

      // --- 決済履歴 ---
      if (order.payments.length > 0) {
        y += 10;
        if (y > 680) {
          doc.addPage();
          y = 50;
        }
        doc.font('NotoSansJP-Bold').fontSize(12).text('決済履歴', 50, y);
        y = doc.y + 6;
        doc.font('NotoSansJP').fontSize(9);
        for (const p of order.payments) {
          const label = `${formatDateTime(p.createdAt)}  ${
            PAYMENT_STATUS_LABELS[p.status as keyof typeof PAYMENT_STATUS_LABELS] ?? p.status
          }  ${formatYen(p.amount)}`;
          doc.text(label, 50, y);
          y = doc.y + 4;
        }
      }

      // --- フッター ---
      doc
        .fontSize(8)
        .fillColor('#888888')
        .text(
          `本書は ${SITE_NAME} が発行する支払明細書です。ご不明な点は運営事務局までお問い合わせください。`,
          50,
          760,
          { width: rightEdge - 50, align: 'center' },
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
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

  const pdfBuffer = await renderInvoicePdf(order);
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
