/**
 * 経理レポート PDF のレンダリングテスト。
 *
 * 見た目そのものは自動では検証できないが、
 * 「壊れたときに気づけない」箇所だけをここで固定する。
 *
 * とくにページ数は重要。フッターをページ下マージンより下に描く実装のため、
 * pdfkit の自動改ページが働くと **白紙ページが増え、1 ページ目のフッターが
 * 消える** という壊れ方をする (実際に一度発生した)。
 * 目視では気づきにくいので、件数に対するページ数をテストで固定する。
 */
import { renderAccountingReportPdf } from './accounting-pdf';
import { summarizePayments, type ReportPayment } from './accounting-report';

/** PDF のページ数を数える (/Type /Page の出現数) */
function countPages(pdf: Buffer): number {
  const s = pdf.toString('latin1');
  const m = s.match(/\/Type\s*\/Page[^s]/g);
  return m ? m.length : 0;
}

function makePayment(i: number, over: Partial<ReportPayment> = {}): ReportPayment {
  return {
    id: `p_${i}`,
    kind: 'SUBSCRIPTION',
    amount: 666,
    createdAt: new Date(Date.UTC(2026, 7, 1 + (i % 28), 3, 0, 0)),
    feeAmount: 24,
    userEmail: `user${i}@example.com`,
    ...over,
  };
}

async function render(payments: ReportPayment[], over: Record<string, unknown> = {}) {
  const summary = summarizePayments(payments);
  return renderAccountingReportPdf({
    periodLabel: '2026年8月',
    from: new Date(Date.UTC(2026, 6, 31, 15, 0, 0)),
    to: new Date(Date.UTC(2026, 7, 31, 15, 0, 0)),
    summary,
    payments,
    generatedBy: 'test@example.com',
    generatedAt: new Date(Date.UTC(2026, 8, 9, 1, 0, 0)),
    ...over,
  });
}

describe('renderAccountingReportPdf', () => {
  it('PDF として読める Buffer を返す', async () => {
    const pdf = await render([makePayment(0)]);
    expect(pdf.length).toBeGreaterThan(1000);
    // PDF のマジックナンバー
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('明細が少ないときは 1 ページに収まる (白紙ページを作らない)', async () => {
    const payments = Array.from({ length: 11 }, (_, i) => makePayment(i));
    const pdf = await render(payments);
    // フッター描画で自動改ページが起きると 2 ページ以上になる。
    expect(countPages(pdf)).toBe(1);
  });

  it('決済が 0 件でも 1 ページで出力できる', async () => {
    const pdf = await render([]);
    expect(countPages(pdf)).toBe(1);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('明細が多いときはページが増える (ただし件数に比例しすぎない)', async () => {
    const payments = Array.from({ length: 90 }, (_, i) => makePayment(i));
    const pdf = await render(payments);
    const pages = countPages(pdf);
    expect(pages).toBeGreaterThan(1);
    // 1 ページあたり 40 行以上は入る想定。極端にページが増えていたら異常。
    expect(pages).toBeLessThanOrEqual(4);
  });

  it('手数料が取得できない決済・EC注文・チケット代が混ざっても落ちない', async () => {
    const payments: ReportPayment[] = [
      makePayment(0),
      makePayment(1, { feeAmount: null }),
      makePayment(2, {
        kind: 'ONE_TIME_ORDER',
        amount: 6300,
        order: { subtotal: 5500, taxAmount: 550, shippingFee: 250 },
        orderNumber: 'RR-20260811-0001',
      }),
      makePayment(3, { kind: 'TICKET_FEE', amount: 3300 }),
      // 未知の種別が来ても種別ラベルにフォールバックして描画できること
      makePayment(4, { kind: 'SOMETHING_NEW', amount: 1100 }),
    ];
    const pdf = await render(payments, { feeTruncated: true, omittedRows: 5 });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(countPages(pdf)).toBe(1);
  });

  it('手数料が全件取得できない場合でも PDF が生成できる', async () => {
    // 表示内容 (「取得不可 / 算出不可」への切り替え) は
    // accounting-report.test.ts の isFeeTotallyUnavailable で検証している。
    // ここでは描画が落ちないことだけを担保する。
    const payments = Array.from({ length: 5 }, (_, i) => makePayment(i, { feeAmount: null }));
    const pdf = await render(payments);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(countPages(pdf)).toBe(1);
  });

  it('会員メールが極端に長くてもレイアウトが崩れずページ数が保たれる', async () => {
    const payments = Array.from({ length: 10 }, (_, i) =>
      makePayment(i, { userEmail: `${'very-long-address'.repeat(6)}${i}@example.com` }),
    );
    const pdf = await render(payments);
    // 折り返して行が伸び、想定外に改ページされていないこと
    expect(countPages(pdf)).toBe(1);
  });
});
