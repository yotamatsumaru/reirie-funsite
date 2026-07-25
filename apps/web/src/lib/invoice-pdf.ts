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

/**
 * ブランドカラーパレット (globals.css の brand-* / Point Magenta に対応)。
 * 明細書の配色はこのパレットで統一する。
 */
const COLORS = {
  brand: '#c263a2', // brand-500 Point Magenta
  brandDark: '#883d6f', // brand-700
  brandDeep: '#2b1522', // brand-900 見出し濃色
  brandTint: '#faf1f6', // brand-50 薄いピンク
  brandTint2: '#f4dfee', // brand-100
  ink: '#2b2530', // 本文
  sub: '#6b6470', // 補足テキスト
  faint: '#9a93a1', // さらに薄い
  line: '#ecdff0', // 罫線 (ピンク寄りグレー)
  lineSoft: '#f3eef6',
  white: '#ffffff',
  ok: '#2e9e6b', // 成功系
} as const;

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
      // bufferPages: true → 全ページ描画後にフッターをまとめて描ける (ページ番号用)
      const pdf = new PDFDocument({
        size: 'A4',
        margin: 50,
        font: null as never,
        bufferPages: true,
      });
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

      // ページ全体のレイアウト基準
      const PAGE_W = pdf.page.width; // A4 = 595.28pt
      const MARGIN = 50;
      const LEFT = MARGIN;
      const RIGHT = PAGE_W - MARGIN; // 545.28
      const CONTENT_W = RIGHT - LEFT;

      // 小さなヘルパ: 角丸塗り
      const fillRoundedRect = (
        x: number,
        yy: number,
        w: number,
        h: number,
        r: number,
        color: string,
      ) => {
        pdf.save();
        pdf.roundedRect(x, yy, w, h, r).fill(color);
        pdf.restore();
      };

      // =====================================================================
      // ① ブランドヘッダーバンド (上部にマゼンタの帯)
      // =====================================================================
      const HEADER_H = 96;
      pdf.save();
      pdf.rect(0, 0, PAGE_W, HEADER_H).fill(COLORS.brand);
      // 帯の下に濃色のアクセントライン
      pdf.rect(0, HEADER_H, PAGE_W, 3).fill(COLORS.brandDark);
      pdf.restore();

      // ロゴ的ワードマーク (左)
      pdf
        .font('NotoSansJP-Bold')
        .fontSize(20)
        .fillColor(COLORS.white)
        .text(INVOICE_SITE_NAME, LEFT, 30, { lineBreak: false });
      pdf
        .font('NotoSansJP')
        .fontSize(8.5)
        .fillColor('#fbe9f4')
        .text('アイドル ファンクラブ / 会員限定サービス', LEFT, 56, { lineBreak: false });

      // タイトル (右) : 英字 + 和文
      pdf
        .font('NotoSansJP-Bold')
        .fontSize(22)
        .fillColor(COLORS.white)
        .text(doc.title, LEFT, 30, { width: CONTENT_W, align: 'right' });
      pdf
        .font('NotoSansJP')
        .fontSize(9)
        .fillColor('#fbe9f4')
        .text('INVOICE / PAYMENT STATEMENT', LEFT, 60, { width: CONTENT_W, align: 'right' });

      // =====================================================================
      // ② メタ情報カード (決済番号・各種日付・状況)
      // =====================================================================
      let y = HEADER_H + 26;

      // 決済番号バッジ (左) と 状況チップ (右) を同じ行に
      pdf
        .font('NotoSansJP')
        .fontSize(8)
        .fillColor(COLORS.faint)
        .text(doc.documentNumberLabel.toUpperCase(), LEFT, y, { lineBreak: false });
      pdf
        .font('NotoSansJP-Bold')
        .fontSize(13)
        .fillColor(COLORS.brandDeep)
        .text(doc.documentNumber, LEFT, y + 11, { width: CONTENT_W * 0.62 });

      // 状況チップ (右上)
      const paid = doc.paidAt != null;
      const chipColor = paid ? COLORS.ok : COLORS.brand;
      const chipBg = paid ? '#e8f6ef' : COLORS.brandTint2;
      const chipText = doc.statusLabel;
      pdf.font('NotoSansJP-Bold').fontSize(9.5);
      const chipTextW = pdf.widthOfString(chipText);
      const chipW = chipTextW + 26;
      const chipH = 22;
      const chipX = RIGHT - chipW;
      const chipY = y + 4;
      fillRoundedRect(chipX, chipY, chipW, chipH, 11, chipBg);
      pdf.save();
      pdf.circle(chipX + 12, chipY + chipH / 2, 3).fill(chipColor);
      pdf.restore();
      pdf
        .fillColor(chipColor)
        .text(chipText, chipX + 18, chipY + 6, { lineBreak: false });

      y += 40;

      // 情報カード (薄ピンクの角丸ボックスに日付類)
      const infoRows: Array<[string, string]> = [
        ['発行日', formatInvoiceDate(new Date())],
        [doc.occurredAtLabel, formatInvoiceDateTime(doc.occurredAt)],
      ];
      if (doc.paidAt) infoRows.push(['お支払い日', formatInvoiceDateTime(doc.paidAt)]);
      infoRows.push(['状況', doc.statusLabel]);

      const cardPad = 14;
      const rowH = 18;
      const cardH = cardPad * 2 + infoRows.length * rowH;
      fillRoundedRect(LEFT, y, CONTENT_W, cardH, 8, COLORS.brandTint);
      // 左端のアクセントバー
      pdf.save();
      pdf.roundedRect(LEFT, y, 4, cardH, 2).fill(COLORS.brand);
      pdf.restore();

      let iy = y + cardPad;
      for (const [label, value] of infoRows) {
        pdf
          .font('NotoSansJP')
          .fontSize(9.5)
          .fillColor(COLORS.sub)
          .text(label, LEFT + 20, iy, { width: 120, lineBreak: false });
        pdf
          .font('NotoSansJP-Bold')
          .fontSize(9.5)
          .fillColor(COLORS.ink)
          .text(value, LEFT + 150, iy, { width: CONTENT_W - 170, lineBreak: false });
        iy += rowH;
      }
      y += cardH + 24;

      // =====================================================================
      // ③ 宛先 (EC 注文のみ)
      // =====================================================================
      if (doc.billTo) {
        pdf
          .font('NotoSansJP-Bold')
          .fontSize(10.5)
          .fillColor(COLORS.brandDark)
          .text('お届け先', LEFT, y);
        y = pdf.y + 4;
        pdf
          .font('NotoSansJP-Bold')
          .fontSize(11)
          .fillColor(COLORS.ink)
          .text(`${doc.billTo.name} 様`, LEFT, y);
        y = pdf.y + 1;
        pdf
          .font('NotoSansJP')
          .fontSize(9.5)
          .fillColor(COLORS.sub)
          .text(
            `〒${doc.billTo.postalCode} ${doc.billTo.prefecture}${doc.billTo.address1}${
              doc.billTo.address2 ?? ''
            }`,
            LEFT,
            y,
            { width: CONTENT_W },
          );
        y = pdf.y + 18;
      }

      // =====================================================================
      // ④ 内容テーブル (ヘッダー帯 + ゼブラ)
      // =====================================================================
      // セクション見出し
      pdf
        .font('NotoSansJP-Bold')
        .fontSize(11)
        .fillColor(COLORS.brandDeep)
        .text(doc.itemsSectionTitle, LEFT, y, { lineBreak: false });
      // 見出し右の細い装飾ライン
      pdf.save();
      const titleW = pdf.widthOfString(doc.itemsSectionTitle);
      pdf
        .moveTo(LEFT + titleW + 12, y + 8)
        .lineTo(RIGHT, y + 8)
        .lineWidth(1)
        .strokeColor(COLORS.line)
        .stroke();
      pdf.restore();
      y += 22;

      // カラム定義
      const colName = LEFT + 12;
      const colQty = LEFT + 300;
      const colUnit = LEFT + 360;
      const colSub = LEFT + 430;
      const nameW = colQty - colName - 8;
      const hasQtyUnit = doc.items.some((it) => it.quantity != null || it.unitPrice != null);

      // ヘッダー帯
      const headH = 26;
      fillRoundedRect(LEFT, y, CONTENT_W, headH, 6, COLORS.brandDeep);
      pdf.font('NotoSansJP-Bold').fontSize(9).fillColor(COLORS.white);
      const headTextY = y + 8.5;
      pdf.text('内容', colName, headTextY, { width: nameW, lineBreak: false });
      if (hasQtyUnit) {
        pdf.text('数量', colQty, headTextY, { width: colUnit - colQty - 8, align: 'right', lineBreak: false });
        pdf.text('単価', colUnit, headTextY, { width: colSub - colUnit - 8, align: 'right', lineBreak: false });
      }
      pdf.text('金額', colSub, headTextY, { width: RIGHT - colSub - 12, align: 'right', lineBreak: false });
      y += headH;

      // 明細行 (ゼブラ)
      pdf.font('NotoSansJP').fontSize(9.5);
      let zebra = false;
      for (const item of doc.items) {
        const label = item.detail ? `${item.label}\n${item.detail}` : item.label;
        const textH = pdf.heightOfString(item.label, { width: nameW });
        const detailH = item.detail
          ? pdf.heightOfString(item.detail, { width: nameW }) + 1
          : 0;
        const rowH2 = Math.max(28, textH + detailH + 14);

        // ページまたぎ
        if (y + rowH2 > 760) {
          pdf.addPage();
          y = MARGIN;
        }

        if (zebra) fillRoundedRect(LEFT, y, CONTENT_W, rowH2, 0, COLORS.lineSoft);
        zebra = !zebra;

        const cellY = y + 8;
        // 主タイトル + 補足
        pdf.font('NotoSansJP-Bold').fontSize(9.5).fillColor(COLORS.ink);
        pdf.text(item.label, colName, cellY, { width: nameW, lineBreak: true });
        if (item.detail) {
          pdf
            .font('NotoSansJP')
            .fontSize(8)
            .fillColor(COLORS.sub)
            .text(item.detail, colName, pdf.y + 1, { width: nameW });
        }
        void label;

        if (hasQtyUnit) {
          pdf.font('NotoSansJP').fontSize(9.5).fillColor(COLORS.ink);
          pdf.text(item.quantity != null ? String(item.quantity) : '—', colQty, cellY, {
            width: colUnit - colQty - 8,
            align: 'right',
            lineBreak: false,
          });
          pdf.text(item.unitPrice != null ? formatYen(item.unitPrice) : '—', colUnit, cellY, {
            width: colSub - colUnit - 8,
            align: 'right',
            lineBreak: false,
          });
        }
        pdf.font('NotoSansJP-Bold').fontSize(9.5).fillColor(COLORS.ink);
        pdf.text(formatYen(item.subtotal), colSub, cellY, {
          width: RIGHT - colSub - 12,
          align: 'right',
          lineBreak: false,
        });

        // 行の下罫線
        pdf.save();
        pdf
          .moveTo(LEFT, y + rowH2)
          .lineTo(RIGHT, y + rowH2)
          .lineWidth(0.5)
          .strokeColor(COLORS.line)
          .stroke();
        pdf.restore();

        y += rowH2;
      }
      y += 16;

      // =====================================================================
      // ⑤ 金額まとめ + 合計ボックス
      // =====================================================================
      const sumLabelX = colUnit - 40;
      const sumValueX = colSub;
      const sumLabelW = sumValueX - sumLabelX - 8;
      const sumValueW = RIGHT - sumValueX - 12;

      const rowsExceptTotal = doc.summary.slice(0, Math.max(0, doc.summary.length - 1));
      const totalRow = doc.summary[doc.summary.length - 1];

      for (const row of rowsExceptTotal) {
        const value = row.negative ? `-${formatYen(row.amount)}` : formatYen(row.amount);
        pdf.font('NotoSansJP').fontSize(10).fillColor(COLORS.sub);
        pdf.text(row.label, sumLabelX, y, { width: sumLabelW, align: 'right', lineBreak: false });
        pdf
          .font('NotoSansJP')
          .fontSize(10)
          .fillColor(COLORS.ink)
          .text(value, sumValueX, y, { width: sumValueW, align: 'right', lineBreak: false });
        y += 18;
      }

      // 合計ボックス (ブランド薄ピンクの角丸 + 濃色文字)
      if (totalRow) {
        const totalBoxX = sumLabelX - 12;
        const totalBoxW = RIGHT - totalBoxX;
        const totalBoxH = 34;
        if (y + totalBoxH > 770) {
          pdf.addPage();
          y = MARGIN;
        }
        fillRoundedRect(totalBoxX, y, totalBoxW, totalBoxH, 8, COLORS.brandTint2);
        pdf.save();
        pdf.roundedRect(totalBoxX, y, 4, totalBoxH, 2).fill(COLORS.brand);
        pdf.restore();
        const value = totalRow.negative
          ? `-${formatYen(totalRow.amount)}`
          : formatYen(totalRow.amount);
        pdf
          .font('NotoSansJP-Bold')
          .fontSize(11)
          .fillColor(COLORS.brandDark)
          .text(totalRow.label, totalBoxX + 14, y + 11, {
            width: sumValueX - (totalBoxX + 14) - 8,
            align: 'left',
            lineBreak: false,
          });
        pdf
          .font('NotoSansJP-Bold')
          .fontSize(15)
          .fillColor(COLORS.brandDeep)
          .text(value, sumValueX, y + 9, { width: sumValueW, align: 'right', lineBreak: false });
        y += totalBoxH + 8;
      }

      // =====================================================================
      // ⑥ 決済履歴
      // =====================================================================
      if (doc.paymentHistory && doc.paymentHistory.length > 0) {
        y += 16;
        if (y > 700) {
          pdf.addPage();
          y = MARGIN;
        }
        pdf
          .font('NotoSansJP-Bold')
          .fontSize(11)
          .fillColor(COLORS.brandDeep)
          .text(doc.paymentHistorySectionTitle ?? '決済履歴', LEFT, y, { lineBreak: false });
        pdf.save();
        const phTitle = doc.paymentHistorySectionTitle ?? '決済履歴';
        const phTitleW = pdf.widthOfString(phTitle);
        pdf
          .moveTo(LEFT + phTitleW + 12, y + 8)
          .lineTo(RIGHT, y + 8)
          .lineWidth(1)
          .strokeColor(COLORS.line)
          .stroke();
        pdf.restore();
        y += 22;

        pdf.font('NotoSansJP').fontSize(9);
        for (const p of doc.paymentHistory) {
          if (y + 18 > 770) {
            pdf.addPage();
            y = MARGIN;
          }
          pdf.fillColor(COLORS.sub).text(formatInvoiceDateTime(p.createdAt), LEFT + 4, y, {
            width: 180,
            lineBreak: false,
          });
          pdf.fillColor(COLORS.ink).text(p.statusLabel, LEFT + 200, y, {
            width: 120,
            lineBreak: false,
          });
          pdf
            .font('NotoSansJP-Bold')
            .fillColor(COLORS.ink)
            .text(formatYen(p.amount), colSub, y, {
              width: RIGHT - colSub - 12,
              align: 'right',
              lineBreak: false,
            });
          pdf.font('NotoSansJP');
          y += 18;
        }
      }

      // =====================================================================
      // ⑦ フッター (全ページ共通)
      // =====================================================================
      const footerNote =
        doc.footerNote ??
        `本書は ${INVOICE_SITE_NAME} が発行する支払明細書です。ご不明な点は運営事務局までお問い合わせください。`;
      const range = pdf.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        pdf.switchToPage(i);
        // フッターはページ下部 (ボトムマージン付近) に描画する。
        //   pdfkit は text() の描画開始 Y + 行高がボトムマージン
        //   (page.height - margins.bottom = 791.89) を超えると
        //   自動的に空白ページを追加してしまう。lineBreak:false でも
        //   これは防げないため、フッター描画の間だけボトムマージンを
        //   0 にして自動改ページを無効化する。
        const savedBottom = pdf.page.margins.bottom;
        pdf.page.margins.bottom = 0;

        const lineY = pdf.page.height - 62;
        const textY = pdf.page.height - 54;
        // 上罫線
        pdf.save();
        pdf
          .moveTo(LEFT, lineY)
          .lineTo(RIGHT, lineY)
          .lineWidth(0.75)
          .strokeColor(COLORS.line)
          .stroke();
        pdf.restore();
        pdf
          .font('NotoSansJP')
          .fontSize(7.5)
          .fillColor(COLORS.faint)
          .text(footerNote, LEFT, textY, {
            width: CONTENT_W,
            align: 'center',
            lineBreak: false,
          });
        // ページ番号 (複数ページのときのみ)
        if (range.count > 1) {
          pdf
            .fontSize(7.5)
            .fillColor(COLORS.faint)
            .text(`${i - range.start + 1} / ${range.count}`, LEFT, textY, {
              width: CONTENT_W,
              align: 'right',
              lineBreak: false,
            });
        }

        // ボトムマージンを元に戻す
        pdf.page.margins.bottom = savedBottom;
      }

      pdf.flushPages();
      pdf.end();
    } catch (err) {
      reject(err);
    }
  });
}
