/**
 * 経理用 月次売上レポート PDF のレンダラ。
 *
 * ## 既存の invoice-pdf.ts と分けている理由
 *
 * あちらは «1 件の取引を 1 枚に清書する» 明細書で、
 * 宛先・注文明細・合計という固定の構成を持つ。
 * こちらは «期間内の全取引を一覧する» 帳票で、
 *   - 行数が数百件になり複数ページに跨る
 *   - ページごとに表のヘッダーを繰り返す必要がある
 *   - 税区分・手数料という別の列構成
 * と要件が根本的に違うため、共用すると両方が複雑になる。
 *
 * フォント解決・配色・金額書式といった «共通の作法» は
 * invoice-pdf.ts と揃えてある (見た目の統一のため)。
 *
 * ## 帳票としての注意書きを必ず入れる
 *
 * この PDF は社内の管理資料であり、適格請求書 (インボイス) の
 * 要件は満たしていない。税務上の書類と誤用されないよう、
 * フッターに明記する。
 */
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { PAYMENT_KIND_LABELS } from '@idol/shared';
import type { AccountingSummary, ReportPayment } from './accounting-report';
import { taxBreakdownForPayment, isFeeTotallyUnavailable } from './accounting-report';

/**
 * Noto Sans JP の在り処を解決する。
 * 探索する理由は invoice-pdf.ts と同じ
 * (standalone build では .ttf がトレースされず cwd 決め打ちだと ENOENT)。
 */
function resolveFontDir(): string {
  const candidates = [
    path.join(process.cwd(), 'src', 'lib', 'fonts'),
    path.join(process.cwd(), 'apps', 'web', 'src', 'lib', 'fonts'),
    path.join(__dirname, 'fonts'),
    path.join(__dirname, '..', 'lib', 'fonts'),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'NotoSansJP-Regular.ttf'))) return dir;
    } catch {
      // 探索は続行
    }
  }
  return candidates[0]!;
}

const FONT_DIR = resolveFontDir();
const FONT_REGULAR = path.join(FONT_DIR, 'NotoSansJP-Regular.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'NotoSansJP-Bold.ttf');

const COLORS = {
  brand: '#c263a2',
  brandDark: '#883d6f',
  brandTint: '#faf1f6',
  ink: '#2b2530',
  sub: '#6b6470',
  faint: '#9a93a1',
  line: '#ecdff0',
  white: '#ffffff',
  warn: '#b45309',
} as const;

function yen(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}¥${Math.abs(n).toLocaleString('ja-JP')}`;
}

/** JST で YYYY/MM/DD を作る (サーバーが UTC でも日付がずれないように) */
function jstDate(d: Date): string {
  return d.toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function jstDateTime(d: Date): string {
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function kindLabel(kind: string): string {
  return (PAYMENT_KIND_LABELS as Record<string, string>)[kind] ?? kind;
}

export type AccountingReportDocument = {
  /** 見出しに出す期間 (例: '2026年9月') */
  periodLabel: string;
  /** 集計対象の期間 (半開区間) */
  from: Date;
  to: Date;
  summary: AccountingSummary;
  /** 明細行 (日付昇順で渡すこと) */
  payments: ReportPayment[];
  /** 出力者のメール (監査目的で紙面に残す) */
  generatedBy: string;
  generatedAt: Date;
  /** 手数料の取得を打ち切った場合の注記 */
  feeTruncated?: boolean;
  /** 明細の表示を打ち切った件数 (0 なら全件) */
  omittedRows?: number;
};

export async function renderAccountingReportPdf(
  doc: AccountingReportDocument,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const pdf = new PDFDocument({
        size: 'A4',
        margin: 40,
        // 既定フォント (Helvetica) の .afm は standalone でトレースされないため無効化。
        font: null as never,
        bufferPages: true,
      });
      const chunks: Buffer[] = [];
      pdf.on('data', (c: Buffer) => chunks.push(c));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);

      pdf.registerFont('JP', fs.readFileSync(FONT_REGULAR));
      pdf.registerFont('JP-Bold', fs.readFileSync(FONT_BOLD));
      pdf.font('JP');

      const PAGE_W = pdf.page.width;
      const PAGE_H = pdf.page.height;
      const M = 40;
      const LEFT = M;
      const RIGHT = PAGE_W - M;
      const WIDTH = RIGHT - LEFT;

      // ================= ヘッダー =================
      pdf.rect(0, 0, PAGE_W, 70).fill(COLORS.brand);
      pdf.rect(0, 70, PAGE_W, 2.5).fill(COLORS.brandDark);
      pdf
        .font('JP-Bold')
        .fontSize(16)
        .fillColor(COLORS.white)
        .text('売上・手数料レポート', LEFT, 20, { lineBreak: false });
      pdf
        .font('JP')
        .fontSize(9)
        .fillColor('#fbe9f4')
        .text(`ReiRieRoom / ${doc.periodLabel}`, LEFT, 44, { lineBreak: false });
      pdf
        .font('JP')
        .fontSize(8)
        .fillColor('#fbe9f4')
        .text(
          `出力: ${jstDateTime(doc.generatedAt)}`,
          RIGHT - 200,
          26,
          { width: 200, align: 'right', lineBreak: false },
        );
      pdf.text(doc.generatedBy, RIGHT - 200, 40, {
        width: 200,
        align: 'right',
        lineBreak: false,
      });

      let y = 92;

      // 対象期間 (JST であることを明示する。経理では境界が重要)
      pdf
        .font('JP')
        .fontSize(8.5)
        .fillColor(COLORS.sub)
        .text(
          `対象期間: ${jstDate(doc.from)} 〜 ${jstDate(
            new Date(doc.to.getTime() - 1),
          )} (日本時間) / 成功した決済のみ`,
          LEFT,
          y,
        );
      y += 20;

      // ================= サマリー =================
      const s = doc.summary;
      const boxH = 76;
      pdf.roundedRect(LEFT, y, WIDTH, boxH, 6).fill(COLORS.brandTint);

      /**
       * 4 つの数字を横並びに出す。
       * 「差引入金額」を一番右の強調位置に置くのは、
       * 経理が最初に確認するのが «実際に入金される額» だから。
       *
       * ⚠️ 手数料が 1 件も取得できなかった場合の表示に注意。
       *    そのまま「手数料 - ¥0 / 差引入金額 = 売上全額」と出すと、
       *    «手数料ゼロで全額入金された» と誤読される。
       *    実際には «わからない» だけなので、数字を出さず「取得不可」と書く。
       *    (一部だけ取れている場合は、下の警告文で不足件数を明示する)
       */
      const allFeesMissing = isFeeTotallyUnavailable(s);
      const cells: Array<{ label: string; value: string; strong?: boolean; muted?: boolean }> = [
        { label: '売上 (税込)', value: yen(s.gross) },
        { label: '内 消費税', value: yen(s.tax) },
        allFeesMissing
          ? { label: 'Stripe 手数料', value: '取得不可', muted: true }
          : { label: 'Stripe 手数料', value: `- ${yen(s.fee)}` },
        allFeesMissing
          ? { label: '差引入金額', value: '算出不可', muted: true }
          : { label: '差引入金額', value: yen(s.netPayout), strong: true },
      ];
      const cellW = WIDTH / cells.length;
      cells.forEach((c, i) => {
        const cx = LEFT + cellW * i;
        pdf
          .font('JP')
          .fontSize(8)
          .fillColor(COLORS.sub)
          .text(c.label, cx + 12, y + 14, { width: cellW - 24, lineBreak: false });
        pdf
          .font('JP-Bold')
          .fontSize(c.muted ? 12 : c.strong ? 15 : 13)
          .fillColor(c.muted ? COLORS.warn : c.strong ? COLORS.brandDark : COLORS.ink)
          .text(c.value, cx + 12, y + 32, { width: cellW - 24, lineBreak: false });
        if (i > 0) {
          pdf
            .moveTo(cx, y + 14)
            .lineTo(cx, y + boxH - 14)
            .lineWidth(0.5)
            .stroke(COLORS.line);
        }
      });
      y += boxH + 6;

      pdf
        .font('JP')
        .fontSize(8)
        .fillColor(COLORS.faint)
        .text(
          `決済件数 ${s.count} 件 / 税抜売上 ${yen(s.net)}`,
          LEFT,
          y,
        );
      y += 22;

      // 手数料が取れなかった件数は必ず明示する
      // (黙って 0 円扱いにすると利益を過大に見せてしまうため)
      if (s.feeMissing > 0) {
        const warnText = allFeesMissing
          ? `※ ${s.feeMissing} 件すべての Stripe 手数料を取得できませんでした (Stripe に接続できないか、決済情報が見つかりません)。売上・消費税は正しく集計されていますが、手数料と差引入金額は算出できていません。`
          : `※ ${s.feeMissing} 件は Stripe 手数料を取得できませんでした。上記の手数料合計・差引入金額にはこの ${s.feeMissing} 件分が含まれていません。`;
        pdf.font('JP-Bold').fontSize(8.5).fillColor(COLORS.warn);
        // 文言が折り返して 2 行以上になることがあるため、
        // 固定値ではなく実際の描画高さで送る (次の見出しと重なるのを防ぐ)。
        const warnH = pdf.heightOfString(warnText, { width: WIDTH });
        pdf.text(warnText, LEFT, y, { width: WIDTH });
        y += warnH + 10;
      }
      if (doc.feeTruncated) {
        pdf
          .font('JP-Bold')
          .fontSize(8.5)
          .fillColor(COLORS.warn)
          .text(
            '※ 件数が多いため手数料の取得を一部打ち切りました。正確な手数料は Stripe ダッシュボードをご確認ください。',
            LEFT,
            y,
            { width: WIDTH },
          );
        y += 24;
      }

      // ================= 種別ごとの内訳 =================
      pdf
        .font('JP-Bold')
        .fontSize(11)
        .fillColor(COLORS.ink)
        .text('種別ごとの内訳', LEFT, y);
      y += 18;

      const kindCols = [
        { key: 'kind', label: '種別', w: 0.24, align: 'left' as const },
        { key: 'count', label: '件数', w: 0.1, align: 'right' as const },
        { key: 'net', label: '税抜', w: 0.165, align: 'right' as const },
        { key: 'tax', label: '消費税', w: 0.155, align: 'right' as const },
        { key: 'gross', label: '税込', w: 0.17, align: 'right' as const },
        { key: 'fee', label: '手数料', w: 0.17, align: 'right' as const },
      ];

      const drawRow = (
        values: string[],
        cols: typeof kindCols,
        yy: number,
        opts: { bold?: boolean; bg?: string; color?: string } = {},
      ) => {
        if (opts.bg) pdf.rect(LEFT, yy - 3, WIDTH, 16).fill(opts.bg);
        let x = LEFT;
        cols.forEach((c, i) => {
          const w = WIDTH * c.w;
          pdf
            .font(opts.bold ? 'JP-Bold' : 'JP')
            .fontSize(8.5)
            .fillColor(opts.color ?? COLORS.ink)
            .text(values[i] ?? '', x + 4, yy, {
              width: w - 8,
              align: c.align,
              lineBreak: false,
            });
          x += w;
        });
      };

      drawRow(
        kindCols.map((c) => c.label),
        kindCols,
        y,
        { bold: true, bg: COLORS.brandTint, color: COLORS.brandDark },
      );
      y += 18;

      for (const k of s.byKind) {
        drawRow(
          [
            kindLabel(k.kind),
            `${k.count}`,
            yen(k.net),
            yen(k.tax),
            yen(k.gross),
            // 種別内の全件が不明なら金額を出さない (¥0 と誤読されるため)。
            k.feeMissing > 0 && k.fee === 0
              ? `取得不可 (${k.feeMissing}件)`
              : k.feeMissing > 0
                ? `${yen(k.fee)} (${k.feeMissing}件不明)`
                : yen(k.fee),
          ],
          kindCols,
          y,
        );
        pdf
          .moveTo(LEFT, y + 13)
          .lineTo(RIGHT, y + 13)
          .lineWidth(0.4)
          .stroke(COLORS.line);
        y += 17;
      }

      // 合計行 (内訳の検算用)
      drawRow(
        [
          '合計',
          `${s.count}`,
          yen(s.net),
          yen(s.tax),
          yen(s.gross),
          // 全件不明なら ¥0 と書かない (手数料が無かったと誤読されるため)
          allFeesMissing ? '取得不可' : yen(s.fee),
        ],
        kindCols,
        y + 2,
        { bold: true, color: COLORS.brandDark },
      );
      y += 30;

      // ================= 明細 =================
      pdf
        .font('JP-Bold')
        .fontSize(11)
        .fillColor(COLORS.ink)
        .text('決済明細', LEFT, y);
      y += 18;

      const rowCols = [
        { key: 'date', label: '日付', w: 0.11, align: 'left' as const },
        { key: 'kind', label: '種別', w: 0.11, align: 'left' as const },
        { key: 'ref', label: '注文番号 / 会員', w: 0.29, align: 'left' as const },
        { key: 'net', label: '税抜', w: 0.12, align: 'right' as const },
        { key: 'tax', label: '消費税', w: 0.11, align: 'right' as const },
        { key: 'gross', label: '税込', w: 0.12, align: 'right' as const },
        { key: 'fee', label: '手数料', w: 0.14, align: 'right' as const },
      ];

      const BOTTOM = PAGE_H - 60;
      const drawDetailHeader = () => {
        drawRow(
          rowCols.map((c) => c.label),
          rowCols,
          y,
          { bold: true, bg: COLORS.brandTint, color: COLORS.brandDark },
        );
        y += 18;
      };
      drawDetailHeader();

      for (const p of doc.payments) {
        // ページ跨ぎ。表のヘッダーを次ページにも繰り返す
        // (これが無いと 2 ページ目以降どの列が何か分からなくなる)。
        if (y > BOTTOM) {
          pdf.addPage();
          y = M;
          drawDetailHeader();
        }
        const b = taxBreakdownForPayment(p);
        const ref = p.orderNumber || p.userEmail || '—';
        drawRow(
          [
            jstDate(p.createdAt),
            kindLabel(p.kind),
            ref,
            yen(b.net),
            yen(b.tax),
            yen(b.gross),
            p.feeAmount === null ? '取得不可' : yen(p.feeAmount),
          ],
          rowCols,
          y,
          p.feeAmount === null ? { color: COLORS.sub } : {},
        );
        pdf
          .moveTo(LEFT, y + 13)
          .lineTo(RIGHT, y + 13)
          .lineWidth(0.3)
          .stroke(COLORS.line);
        y += 16;
      }

      if (doc.payments.length === 0) {
        pdf
          .font('JP')
          .fontSize(9)
          .fillColor(COLORS.sub)
          .text('この期間に成功した決済はありません。', LEFT + 4, y + 4);
        y += 24;
      }

      if (doc.omittedRows && doc.omittedRows > 0) {
        if (y > BOTTOM - 30) {
          pdf.addPage();
          y = M;
        }
        pdf
          .font('JP-Bold')
          .fontSize(8.5)
          .fillColor(COLORS.warn)
          .text(
            `※ 明細は上限件数で打ち切っています (${doc.omittedRows} 件を非表示)。上のサマリー・種別内訳は打ち切り前の全件で集計しています。`,
            LEFT,
            y + 6,
            { width: WIDTH },
          );
      }

      // ================= フッター (全ページ) =================
      /**
       * ⚠️ フッターは «下マージンより下» に描くため、pdfkit の自動改ページを
       *    必ず無効化しておくこと。
       *
       *    pdfkit は文字の描画位置がページ下端 (height - margins.bottom) を
       *    超えると自動で addPage() する。bufferPages: true の状態でこれが起きると
       *    ループ中に新しい空ページが増え、
       *      - 1 ページ目にフッターが乗らない
       *      - 末尾に白紙ページが増える
       *    という壊れ方をする (実際に発生した)。
       *
       *    page.margins.bottom を一時的に 0 にして «下端がページ最下部» と
       *    みなさせることで、改ページを起こさずに描画する。
       */
      const range = pdf.bufferedPageRange();
      const FOOTER_NOTE =
        'この帳票は社内管理用の集計資料です。適格請求書 (インボイス) ではありません。消費税額はサブスク・チケットは税込価格からの逆算、EC注文は注文時に確定した税額を使用しています。';
      for (let i = 0; i < range.count; i++) {
        pdf.switchToPage(range.start + i);
        const savedBottom = pdf.page.margins.bottom;
        pdf.page.margins.bottom = 0;
        pdf
          .font('JP')
          .fontSize(7.5)
          .fillColor(COLORS.faint)
          .text(FOOTER_NOTE, M, PAGE_H - 46, {
            width: PAGE_W - M * 2,
            align: 'left',
            lineGap: 1,
          });
        pdf
          .font('JP')
          .fontSize(7.5)
          .fillColor(COLORS.faint)
          .text(`${i + 1} / ${range.count}`, M, PAGE_H - 20, {
            width: PAGE_W - M * 2,
            align: 'right',
            lineBreak: false,
          });
        pdf.page.margins.bottom = savedBottom;
      }

      pdf.end();
    } catch (e) {
      reject(e);
    }
  });
}
