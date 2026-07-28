/**
 * ヤマト運輸「B2クラウド」向け 送り状データCSV の入出力ヘルパ。
 *
 * ## 方針 (ユーザー確認済み)
 *  - 配送業者はヤマト B2クラウドのみ。
 *  - 送り状種類 = 0 (発払い)、クール区分 = 0 (通常) をデフォルトとする (宅急便・発払い)。
 *  - 「お客様管理番号」に自社の注文番号 (orderNumber) を入れ、
 *    後で B2 が出力する「発送予定データ (お客様管理番号 + 送り状番号)」を
 *    取り込んで注文に送り状番号を紐づける。
 *
 * ## エクスポート列 (B2クラウド「送り状発行」取込フォーマットの標準的な項目)
 *  B2クラウド側の取込設定は「項目名を対応づける」方式のため、ここでは
 *  分かりやすい日本語ヘッダを出力する。B2 側で列マッピングを一度保存すれば
 *  以降は同じ列構成でそのまま取り込める。
 *
 * ## インポート (送り状番号の取り込み)
 *  B2クラウドが出力する CSV から「お客様管理番号」と「送り状番号」の 2 列を
 *  ヘッダ名で自動検出して読み取る (列順の違いに強くする)。
 */
import { toCsv } from './csv';

/** B2 送り状発行 取込CSV のヘッダ (標準的な宅急便・発払いの項目) */
export const B2_EXPORT_HEADER: string[] = [
  'お客様管理番号',
  '送り状種類',
  'クール区分',
  'お届け先郵便番号',
  'お届け先住所',
  'お届け先アパートマンション名',
  'お届け先会社・部門名１',
  'お届け先名',
  'お届け先電話番号',
  '品名１',
  '個数',
];

/** エクスポート1件ぶんに必要な注文データ */
export interface B2ExportOrder {
  orderNumber: string;
  shippingPostalCode: string;
  shippingPrefecture: string;
  shippingAddress1: string;
  shippingAddress2: string | null;
  shippingName: string;
  shippingPhone: string;
  /** 品名 (代表品名。複数商品は先頭 + "他" とする) */
  itemName: string;
  /** 合計個数 */
  totalQuantity: number;
}

/**
 * 注文配列を B2クラウド取込用CSV文字列 (UTF-8 BOM付き) に変換する。
 * 送り状種類=0(発払い) / クール区分=0(通常) を固定で付与する。
 */
export function buildB2ExportCsv(orders: B2ExportOrder[]): string {
  const rows: string[][] = [B2_EXPORT_HEADER];
  for (const o of orders) {
    rows.push([
      o.orderNumber, // お客様管理番号
      '0', // 送り状種類: 0=発払い
      '0', // クール区分: 0=通常
      normalizePostal(o.shippingPostalCode), // お届け先郵便番号
      `${o.shippingPrefecture}${o.shippingAddress1}`, // 都道府県+市区町村番地
      o.shippingAddress2 ?? '', // 建物・部屋番号
      '', // 会社・部門名 (個人宛のため空)
      o.shippingName, // お届け先名
      normalizePhone(o.shippingPhone), // お届け先電話番号
      truncateItemName(o.itemName), // 品名1
      String(Math.max(1, o.totalQuantity)), // 個数
    ]);
  }
  return toCsv(rows);
}

/** 郵便番号を「123-4567」形式に整える (数字のみ7桁ならハイフン挿入) */
export function normalizePostal(raw: string): string {
  const digits = (raw ?? '').replace(/[^\d]/g, '');
  if (digits.length === 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return raw ?? '';
}

/** 電話番号を数字とハイフンのみに整える (全角→半角、余分な空白除去) */
export function normalizePhone(raw: string): string {
  return (raw ?? '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[－ー―‐]/g, '-') // 全角ハイフン・長音・ダッシュ類を半角ハイフンに
    .replace(/[^\d-]/g, '')
    .trim();
}

/** B2 の品名欄は全角25文字程度が上限。安全側で 25 文字に丸める。 */
export function truncateItemName(name: string): string {
  const n = (name ?? '').trim();
  return n.length > 25 ? `${n.slice(0, 24)}…` : n;
}

// ---------------------------------------------------------------------
// インポート (送り状番号の取り込み)
// ---------------------------------------------------------------------

/** B2 出力CSVで「お客様管理番号」とみなすヘッダ候補 */
const MANAGE_NO_HEADERS = ['お客様管理番号', 'お客様管理番号（半角英数字）', '管理番号'];
/** B2 出力CSVで「送り状番号」とみなすヘッダ候補 */
const TRACKING_HEADERS = ['送り状番号', '伝票番号', 'お問い合わせ送り状No.', 'お問い合わせ送り状Ｎｏ．'];

export interface B2ImportRow {
  orderNumber: string;
  trackingNumber: string;
}

export interface B2ParseResult {
  rows: B2ImportRow[];
  /** 解析できなかった行 (管理番号 or 送り状番号が欠落) の行番号(1始まり・ヘッダ除く) */
  skipped: number[];
  /** ヘッダ検出に失敗した場合のエラー */
  error?: string;
}

/**
 * B2 が出力した「発送予定データ」CSV文字列を解析し、
 * (お客様管理番号=orderNumber, 送り状番号=trackingNumber) の配列を返す。
 *
 *  - BOM を除去。
 *  - ヘッダ行から管理番号列・送り状番号列を名前で検出する (列順非依存)。
 *  - カンマ区切り + ダブルクォート囲みの基本的な CSV に対応。
 */
export function parseB2TrackingCsv(text: string): B2ParseResult {
  const clean = (text ?? '').replace(/^\uFEFF/, '');
  const lines = splitCsvLines(clean).filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { rows: [], skipped: [], error: 'CSVが空です' };
  }

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const manageIdx = findHeaderIndex(header, MANAGE_NO_HEADERS);
  const trackingIdx = findHeaderIndex(header, TRACKING_HEADERS);

  if (manageIdx < 0 || trackingIdx < 0) {
    return {
      rows: [],
      skipped: [],
      error:
        '「お客様管理番号」または「送り状番号」の列が見つかりません。B2クラウドの出力CSVをそのままアップロードしてください。',
    };
  }

  const rows: B2ImportRow[] = [];
  const skipped: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const orderNumber = (cols[manageIdx] ?? '').trim();
    const trackingNumber = (cols[trackingIdx] ?? '').trim();
    if (!orderNumber || !trackingNumber) {
      skipped.push(i); // ヘッダを除いた行位置 (1始まり)
      continue;
    }
    rows.push({ orderNumber, trackingNumber });
  }

  return { rows, skipped };
}

function findHeaderIndex(header: string[], candidates: string[]): number {
  for (const cand of candidates) {
    const idx = header.findIndex((h) => h === cand);
    if (idx >= 0) return idx;
  }
  // 部分一致フォールバック (「送り状番号」を含む列など)
  for (const cand of candidates) {
    const idx = header.findIndex((h) => h.includes(cand));
    if (idx >= 0) return idx;
  }
  return -1;
}

/** CRLF / CR / LF を跨いで論理行に分割する (ダブルクォート内の改行は保持) */
function splitCsvLines(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
      continue;
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      // CRLF の LF はスキップ
      if (ch === '\r' && text[i + 1] === '\n') i++;
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/** 1行を CSV カラム配列に分解する (ダブルクォート・エスケープ対応) */
function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') {
        cols.push(cur);
        cur = '';
      } else cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}
