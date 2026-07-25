/**
 * 支払明細書 (Invoice) PDF の共通レンダラ。
 *
 * - EC 注文 (Order) / サブスクリプション課金 (Payment kind=SUBSCRIPTION) の
 *   どちらの明細書もこの汎用フォーマットで生成する。
 * - pdfkit で日本語 (Noto Sans JP) を埋め込んだ PDF をその場で生成する。
 * - フォント読み込み・ヘッダー/フッター・表組みのレイアウトなど共通部分を
 *   1 箇所に集約し、呼び出し側は「明細データ (InvoiceDocument)」を組み立てるだけでよい。
 */
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Noto Sans JP フォント (TTF) の在り処を解決する。
 *
 * このファイルはビルド後、以下のいずれかの場所から実行される:
 *   - 開発時 (next dev):        process.cwd() = apps/web
 *   - 本番 standalone (PM2):    __dirname は .next/server 配下に置かれるが、
 *                               PM2 の cwd は apps/web なので process.cwd() が有効
 *   - 単体テスト等:             cwd が apps/web 以外になり得る
 *
 * output:'standalone' では、実行時の文字列パスで参照するフォント (.ttf) や
 * pdfkit の標準フォントメトリクス (.afm) が .next/standalone にトレース・コピー
 * されないため、cwd に決め打ちすると本番で ENOENT → PDF 生成が
 * INTERNAL_ERROR になる。複数の候補パスを順に探索して確実に解決する。
 */
function resolveFontDir(): string {
  const candidates = [
    // 1) PM2 の cwd (= apps/web) を基準にしたソース配置
    path.join(process.cwd(), 'src', 'lib', 'fonts'),
    // 2) 万一 cwd がリポジトリルートの場合
    path.join(process.cwd(), 'apps', 'web', 'src', 'lib', 'fonts'),
    // 3) このモジュール自身からの相対 (バンドルされずソースが残る構成向け)
    path.join(__dirname, 'fonts'),
    path.join(__dirname, '..', 'lib', 'fonts'),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'NotoSansJP-Regular.ttf'))) return dir;
    } catch {
      // 探索は続行する
    }
  }
  // どれも見つからなければ従来の既定パスを返す (エラーメッセージで気付けるように)
  return candidates[0];
}

const FONT_DIR = resolveFontDir();
const FONT_REGULAR = path.join(FONT_DIR, 'NotoSansJP-Regular.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'NotoSansJP-Bold.ttf');

export const INVOICE_SITE_NAME = 'ReiRieRoom';

export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`;
}

export function formatInvoiceDate(d: Date): string {
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function formatInvoiceDateTime(d: Date): string {
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 明細書の 1 行 (商品行 / プラン行) */
export interface InvoiceLineItem {
  /** 商品名 / プラン名など、行の主タイトル */
  label: string;
  /** 補足 (バリエーション名 / 課金サイクルなど)。指定時は label に括弧書きで付記する */
  detail?: string;
  quantity?: number;
  unitPrice?: number;
  subtotal: number;
}

/** 金額まとめ (小計/税/送料/合計 等) の 1 行 */
export interface InvoiceSummaryRow {
  label: string;
  amount: number;
  /** true の場合はマイナス表示 (割引など) */
  negative?: boolean;
  /** true の場合は太字・大きめフォントで表示 (合計行など) */
  bold?: boolean;
}

/** 決済履歴 (Payment) の 1 行 */
export interface InvoicePaymentRow {
  createdAt: Date;
  statusLabel: string;
  amount: number;
}

/** 明細書の宛先情報 (EC 注文のみ想定。サブスクは省略可) */
export interface InvoiceBillTo {
  name: string;
  postalCode: string;
  prefecture: string;
  address1: string;
  address2?: string | null;
}

/** 明細書 1 通分のデータ (PDF 化する前の中間表現) */
export interface InvoiceDocument {
  /** 見出し (例: '支払明細書') */
  title: string;
  /** 明細書番号のラベル (例: '注文番号' / '決済番号') */
  documentNumberLabel: string;
  documentNumber: string;
  /** 対象の発生日時のラベルと値 (例: 'ご注文日' / 'お申込み日') */
  occurredAtLabel: string;
  occurredAt: Date;
  /** お支払い日 (未払いなら null) */
  paidAt?: Date | null;
  /** 状況ラベル (例: '入金済み' / '成功') */
  statusLabel: string;
  billTo?: InvoiceBillTo | null;
  /** セクション見出し (例: 'ご注文内容' / 'お申込み内容') */
  itemsSectionTitle: string;
  items: InvoiceLineItem[];
  summary: InvoiceSummaryRow[];
  paymentHistorySectionTitle?: string;
  paymentHistory?: InvoicePaymentRow[];
  /** フッターの注記文 (省略時は既定文) */
  footerNote?: string;
}

/**
 * InvoiceDocument から支払明細書の PDF を生成し、Buffer で返す。
 */
export async function renderInvoicePdf(doc: InvoiceDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      // font: null で pdfkit の既定フォント (Helvetica) の読み込みを抑止する。
      //   pdfkit は標準フォントのメトリクス Helvetica.afm を
      //   `fs.readFileSync(__dirname + '/data/Helvetica.afm')` で読むが、
      //   output:'standalone' ではこの .afm がトレースされず ENOENT になる。
      //   本明細書は日本語 (Noto Sans JP) しか使わないため、標準フォントは不要。
      const pdf = new PDFDocument({ size: 'A4', margin: 50, font: null as never });
      const chunks: Buffer[] = [];
      pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);

      // TTF はこちらで Buffer に読み込んでから登録する。
      //   pdfkit にパス文字列を渡すと pdfkit 内部の fs 解決に依存してしまうため、
      //   自前で読み込んでフォント欠落を確実に検知できるようにする。
      const regularBuf = fs.readFileSync(FONT_REGULAR);
      const boldBuf = fs.readFileSync(FONT_BOLD);
      pdf.registerFont('NotoSansJP', regularBuf);
      pdf.registerFont('NotoSansJP-Bold', boldBuf);
      pdf.font('NotoSansJP');

      // --- タイトル ---
      pdf.font('NotoSansJP-Bold').fontSize(20).text(doc.title, { align: 'center' });
      pdf.moveDown(0.5);
      pdf
        .font('NotoSansJP')
        .fontSize(10)
        .fillColor('#555555')
        .text(INVOICE_SITE_NAME, { align: 'center' });
      pdf.fillColor('#000000');
      pdf.moveDown(1.5);

      // --- 基本情報 ---
      pdf.fontSize(11);
      pdf.text(`${doc.documentNumberLabel}: ${doc.documentNumber}`);
      pdf.text(`発行日: ${formatInvoiceDate(new Date())}`);
      pdf.text(`${doc.occurredAtLabel}: ${formatInvoiceDateTime(doc.occurredAt)}`);
      if (doc.paidAt) {
        pdf.text(`お支払い日: ${formatInvoiceDateTime(doc.paidAt)}`);
      }
      pdf.text(`状況: ${doc.statusLabel}`);
      pdf.moveDown(1);

      // --- 宛先 (EC 注文のみ) ---
      if (doc.billTo) {
        pdf.font('NotoSansJP-Bold').fontSize(12).text('お届け先');
        pdf.font('NotoSansJP').fontSize(11);
        pdf.text(`${doc.billTo.name} 様`);
        pdf.text(
          `〒${doc.billTo.postalCode} ${doc.billTo.prefecture}${doc.billTo.address1}${
            doc.billTo.address2 ?? ''
          }`,
        );
        pdf.moveDown(1);
      }

      // --- 内容 (表) ---
      pdf.font('NotoSansJP-Bold').fontSize(12).text(doc.itemsSectionTitle);
      pdf.moveDown(0.3);

      const tableTop = pdf.y;
      const colX = { name: 50, qty: 340, unit: 400, subtotal: 470 };
      const rightEdge = 545;
      const hasQtyUnit = doc.items.some((it) => it.quantity != null || it.unitPrice != null);

      pdf.fontSize(9).font('NotoSansJP-Bold');
      pdf.text('内容', colX.name, tableTop, { width: colX.qty - colX.name - 10 });
      if (hasQtyUnit) {
        pdf.text('数量', colX.qty, tableTop, { width: colX.unit - colX.qty - 10, align: 'right' });
        pdf.text('単価', colX.unit, tableTop, {
          width: colX.subtotal - colX.unit - 10,
          align: 'right',
        });
      }
      pdf.text('金額', colX.subtotal, tableTop, { width: rightEdge - colX.subtotal, align: 'right' });

      let y = tableTop + 16;
      pdf
        .moveTo(colX.name, y - 4)
        .lineTo(rightEdge, y - 4)
        .strokeColor('#cccccc')
        .stroke();

      pdf.font('NotoSansJP').fontSize(9);
      for (const item of doc.items) {
        const label = item.detail ? `${item.label} (${item.detail})` : item.label;
        const rowHeight = pdf.heightOfString(label, { width: colX.qty - colX.name - 10 }) + 6;

        pdf.text(label, colX.name, y, { width: colX.qty - colX.name - 10 });
        if (hasQtyUnit) {
          pdf.text(item.quantity != null ? String(item.quantity) : '—', colX.qty, y, {
            width: colX.unit - colX.qty - 10,
            align: 'right',
          });
          pdf.text(item.unitPrice != null ? formatYen(item.unitPrice) : '—', colX.unit, y, {
            width: colX.subtotal - colX.unit - 10,
            align: 'right',
          });
        }
        pdf.text(formatYen(item.subtotal), colX.subtotal, y, {
          width: rightEdge - colX.subtotal,
          align: 'right',
        });

        y += rowHeight;

        // ページをまたぐ場合は改ページする
        if (y > 700) {
          pdf.addPage();
          y = 50;
        }
      }

      pdf
        .moveTo(colX.name, y)
        .lineTo(rightEdge, y)
        .strokeColor('#cccccc')
        .stroke();
      y += 12;

      // --- 金額まとめ ---
      const summaryLabelWidth = colX.subtotal - colX.unit - 10;
      const printSummaryRow = (row: InvoiceSummaryRow) => {
        const value = row.negative ? `-${formatYen(row.amount)}` : formatYen(row.amount);
        pdf.font(row.bold ? 'NotoSansJP-Bold' : 'NotoSansJP').fontSize(row.bold ? 12 : 10);
        pdf.text(row.label, colX.unit - 60, y, { width: summaryLabelWidth + 60, align: 'right' });
        pdf.text(value, colX.subtotal, y, { width: rightEdge - colX.subtotal, align: 'right' });
        y += row.bold ? 20 : 16;
      };

      for (let i = 0; i < doc.summary.length; i++) {
        const row = doc.summary[i];
        const isLast = i === doc.summary.length - 1;
        if (isLast && doc.summary.length > 1) {
          pdf
            .moveTo(colX.unit - 60, y - 4)
            .lineTo(rightEdge, y - 4)
            .strokeColor('#333333')
            .stroke();
        }
        printSummaryRow(row);
      }

      // --- 決済履歴 ---
      if (doc.paymentHistory && doc.paymentHistory.length > 0) {
        y += 10;
        if (y > 680) {
          pdf.addPage();
          y = 50;
        }
        pdf
          .font('NotoSansJP-Bold')
          .fontSize(12)
          .text(doc.paymentHistorySectionTitle ?? '決済履歴', 50, y);
        y = pdf.y + 6;
        pdf.font('NotoSansJP').fontSize(9);
        for (const p of doc.paymentHistory) {
          const label = `${formatInvoiceDateTime(p.createdAt)}  ${p.statusLabel}  ${formatYen(
            p.amount,
          )}`;
          pdf.text(label, 50, y);
          y = pdf.y + 4;
        }
      }

      // --- フッター ---
      pdf
        .fontSize(8)
        .fillColor('#888888')
        .text(
          doc.footerNote ??
            `本書は ${INVOICE_SITE_NAME} が発行する支払明細書です。ご不明な点は運営事務局までお問い合わせください。`,
          50,
          760,
          { width: rightEdge - 50, align: 'center' },
        );

      pdf.end();
    } catch (err) {
      reject(err);
    }
  });
}
