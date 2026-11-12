/**
 * newsletter-b2 — 会報誌の発送先を ヤマト B2クラウド「送り状発行」取込CSV に変換する
 *
 * 【EC の発送CSV (lib/yamato-b2.ts) と同じ列構成にしている理由】
 * B2クラウドは取込時に «列と項目の対応づけ» を保存して使い回す。
 * EC で既に保存済みの取込設定をそのまま使えるよう、同じ buildB2ExportCsv を通す。
 *
 * 【列の中身】
 *  - お客様管理番号 : 会員番号 (RR-000123)。無ければ «U-<ユーザーIDの先頭8桁>»
 *  - 送り状種類     : 画面で選んだもの (既定 0=発払い。会報誌ならネコポス 7 / DM便 3 も可)
 *  - お届け先       : マイページの住所・本名 (本名が無ければ表示名)
 *  - 品名           : 画面で入力したもの (既定「会報誌」)
 *  - 個数           : 1
 */
import { isShippable, recipientName } from '@idol/shared';
import { buildB2ExportCsv, type B2ExportOrder } from '@/lib/yamato-b2';
import type { TargetUser } from '@/lib/newsletter-mail';

export type NewsletterB2Options = {
  /** 品名 (例: 「会報誌 2026年 夏号」) */
  itemName: string;
  /** 送り状種類コード (0=発払い / 7=ネコポス / 8=宅急便コンパクト / 3=DM便) */
  invoiceType: string;
};

export type NewsletterB2Result = {
  csv: string;
  /** CSV に含めた人数 (= 住所が揃っている人) */
  exported: number;
  /** 住所などが足りず CSV に含めなかった人数 */
  skippedNeedsInfo: number;
  /** CSV には含めたが電話番号が無い人数 (B2 は電話番号必須のため取込時にエラーになる) */
  missingPhone: number;
};

/** B2 のお客様管理番号 (半角英数字・記号) */
export function b2ManagementNumber(u: Pick<TargetUser, 'id' | 'memberNumber'>): string {
  return u.memberNumber?.trim() || `U-${u.id.replace(/-/g, '').slice(0, 8)}`;
}

/**
 * 会報誌の発送対象を B2 取込CSV に変換する。
 * 住所が揃っていない会員は送り状を作れないので含めない (件数だけ返す)。
 */
export function buildNewsletterB2Csv(
  members: readonly TargetUser[],
  opts: NewsletterB2Options,
): NewsletterB2Result {
  const rows: B2ExportOrder[] = [];
  let skippedNeedsInfo = 0;
  let missingPhone = 0;

  for (const u of members) {
    if (!isShippable(u)) {
      skippedNeedsInfo += 1;
      continue;
    }
    if (!u.phone?.trim()) missingPhone += 1;
    rows.push({
      orderNumber: b2ManagementNumber(u),
      shippingPostalCode: u.postalCode ?? '',
      shippingPrefecture: u.prefecture?.trim() ?? '',
      shippingAddress1: u.addressLine1?.trim() ?? '',
      shippingAddress2: u.addressLine2?.trim() || null,
      shippingName: recipientName(u),
      shippingPhone: u.phone ?? '',
      itemName: opts.itemName,
      totalQuantity: 1,
      invoiceType: opts.invoiceType,
    });
  }

  return { csv: buildB2ExportCsv(rows), exported: rows.length, skippedNeedsInfo, missingPhone };
}
