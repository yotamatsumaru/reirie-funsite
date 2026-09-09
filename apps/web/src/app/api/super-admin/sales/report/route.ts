/**
 * GET /api/super-admin/sales/report?month=YYYY-MM
 *   - 経理用の月次売上レポートを PDF で出力する
 *   - 売上 (税込 / 税抜 / 消費税) と Stripe 手数料、差引入金額をまとめる
 *
 * ## 対象を «成功した決済» に限る理由
 *
 * Payment には FAILED / PENDING / REFUNDED も入る。
 * 経理が知りたいのは «実際に入金された金額» なので SUCCEEDED のみを集計する。
 * (失敗した決済を混ぜると売上が過大になる)
 *
 * ## 期間は JST 基準
 *
 * サーバーは UTC で動くため、UTC のまま月初を切ると
 * 日本時間 1 日の 0:00〜8:59 の決済が前月に入ってしまう。
 * jstMonthRange で JST の月初〜翌月初 (半開区間) に変換する。
 *
 * ## 手数料は Stripe から都度取得する
 *
 * 手数料は DB に保存していない。詳細は lib/stripe-fees.ts の冒頭コメント参照。
 * 取得できなかったものは «0 円» ではなく «取得不可» として PDF に明示する。
 *
 * ## 権限
 *
 * requireSuperAdminView (SUPER_ADMIN / STAFF) — 読み取り専用のためスタッフも出力可。
 * 財務データの持ち出しにあたるので、CSV エクスポートと同様に監査ログを残す。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireSuperAdminView } from '@/auth';
import { handle, errors } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import {
  jstMonthRange,
  formatMonthLabel,
  currentJstMonth,
  summarizePayments,
  type ReportPayment,
} from '@/lib/accounting-report';
import { fetchStripeFees, FEE_LOOKUP_LIMIT } from '@/lib/stripe-fees';
import { renderAccountingReportPdf } from '@/lib/accounting-pdf';

export const runtime = 'nodejs';

/**
 * 1 か月分として読み込む決済の上限。
 * これを超える場合、合計は «読み込めた分» になるため PDF に注記を出す。
 */
const PAYMENT_LIMIT = 5000;

/** 明細表に印字する最大行数 (ページ数が膨らみすぎるのを防ぐ) */
const DETAIL_ROW_LIMIT = 1000;

type PaymentRecord = {
  id: string;
  kind: string;
  amount: number;
  createdAt: Date;
  stripeChargeId: string | null;
  stripePaymentIntentId: string | null;
  user?: { email: string } | null;
  order?: { subtotal: number; taxAmount: number; shippingFee: number; orderNumber: string } | null;
};

export const GET = handle(async (req: Request) => {
  const session = await requireSuperAdminView();
  const url = new URL(req.url);
  const month = url.searchParams.get('month')?.trim() || currentJstMonth();

  const range = jstMonthRange(month);
  if (!range) {
    throw errors.badRequest('対象月の指定が正しくありません (YYYY-MM 形式)');
  }

  const payments = (await prisma.payment.findMany({
    where: {
      status: 'SUCCEEDED',
      createdAt: { gte: range.from, lt: range.to },
    },
    select: {
      id: true,
      kind: true,
      amount: true,
      createdAt: true,
      stripeChargeId: true,
      stripePaymentIntentId: true,
      user: { select: { email: true } },
      order: {
        select: { subtotal: true, taxAmount: true, shippingFee: true, orderNumber: true },
      },
    },
    // 明細は発生順に読めるほうが帳簿と突き合わせやすい。
    orderBy: { createdAt: 'asc' },
    take: PAYMENT_LIMIT,
  })) as unknown as PaymentRecord[];

  // Stripe から手数料をまとめて取得する (取得できないものは Map に入らない)。
  const feeResult = await fetchStripeFees(
    payments.map((p) => ({
      id: p.id,
      stripeChargeId: p.stripeChargeId,
      stripePaymentIntentId: p.stripePaymentIntentId,
    })),
  );

  const reportPayments: ReportPayment[] = payments.map((p) => ({
    id: p.id,
    kind: p.kind,
    amount: p.amount,
    createdAt: p.createdAt,
    // Map に無い = 取得できなかった。0 ではなく null にして «取得不可» と表示する。
    feeAmount: feeResult.fees.has(p.id) ? feeResult.fees.get(p.id)! : null,
    order: p.order
      ? { subtotal: p.order.subtotal, taxAmount: p.order.taxAmount, shippingFee: p.order.shippingFee }
      : null,
    userEmail: p.user?.email ?? null,
    orderNumber: p.order?.orderNumber ?? null,
  }));

  // 合計は «全件» を対象にする。明細だけ行数を絞る
  // (合計まで絞ると帳簿の数字が変わってしまうため)。
  const summary = summarizePayments(reportPayments);
  const detailRows = reportPayments.slice(0, DETAIL_ROW_LIMIT);
  const omittedRows = reportPayments.length - detailRows.length;

  const pdf = await renderAccountingReportPdf({
    periodLabel: formatMonthLabel(month),
    from: range.from,
    to: range.to,
    summary,
    payments: detailRows,
    generatedBy: session.user.email ?? session.user.id,
    generatedAt: new Date(),
    feeTruncated: reportPayments.length > FEE_LOOKUP_LIMIT,
    omittedRows,
  });

  await logAudit({
    userId: session.user.id,
    action: 'sales.report_pdf',
    resource: 'payments',
    userAgent: req.headers.get('user-agent') ?? undefined,
    metadata: {
      month,
      count: summary.count,
      gross: summary.gross,
      tax: summary.tax,
      fee: summary.fee,
      feeMissing: summary.feeMissing,
      truncated: payments.length >= PAYMENT_LIMIT,
    },
  });

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="sales-report-${month}.pdf"`,
      // 売上情報なのでプロキシ・ブラウザにキャッシュさせない。
      'Cache-Control': 'no-store',
    },
  });
});
