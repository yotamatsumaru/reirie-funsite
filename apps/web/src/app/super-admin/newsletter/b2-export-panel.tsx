'use client';

/**
 * b2-export-panel — 会報誌の発送先を ヤマト B2クラウド取込CSV でダウンロードするパネル
 *
 * 対象は «発送連絡メール» と同じ「基準日時点の年間会員のうち住所が揃っている人」。
 * 送り状を作った人と «発送しました» メールが届く人を一致させるため、
 * 基準日はページ上部 (発送連絡) と同じ値を使う (?cutoff=)。
 */

import { useState } from 'react';
import { B2_INVOICE_TYPES } from '@idol/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';

/** "2026-08-15" → "2026年8月15日" */
function cutoffLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

export function B2ExportPanel({
  cutoffDate,
  annualMemberCount,
  shippableCount,
  missingPhoneCount,
}: {
  cutoffDate: string;
  /** 基準日時点の年間会員数 */
  annualMemberCount: number;
  /** そのうち住所が揃っていて CSV に入る人数 */
  shippableCount: number;
  /** CSV には入るが電話番号が無い人数 (B2 取込時にエラーになる) */
  missingPhoneCount: number;
}) {
  const [invoiceType, setInvoiceType] = useState('0');
  const [itemName, setItemName] = useState('会報誌');

  const params = new URLSearchParams({
    cutoff: cutoffDate,
    invoiceType,
    itemName: itemName.trim() || '会報誌',
  });
  const href = `/api/super-admin/newsletter/b2-export?${params.toString()}`;
  const needsInfo = annualMemberCount - shippableCount;

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-slate-700">ヤマト運輸 発送用CSV（B2クラウド）</h2>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-xs leading-relaxed text-slate-500">
          <span className="font-semibold">{cutoffLabel(cutoffDate)}時点で年間会員</span>
          だった方（{annualMemberCount} 名）のうち、住所が揃っている
          <span className="font-semibold text-emerald-600"> {shippableCount} 名</span>
          の送り状データを、B2クラウドの「送り状発行（外部データ取込）」用CSVで出力します。
          {needsInfo > 0 && (
            <>
              {' '}
              住所が未入力の <span className="font-semibold text-amber-600">{needsInfo} 名</span>
              は含まれません。
            </>
          )}
          <br />
          基準日は下の「発送したことを知らせる」と共通です（送り状を作った人と、発送連絡メールが届く人が一致します）。
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="送り状種類"
            value={invoiceType}
            onChange={(e) => setInvoiceType(e.target.value)}
          >
            {B2_INVOICE_TYPES.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </Select>
          <Input
            label="品名（25文字まで）"
            value={itemName}
            maxLength={25}
            onChange={(e) => setItemName(e.target.value)}
            hint="例: 会報誌 2026年 夏号"
          />
        </div>

        {missingPhoneCount > 0 && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
            電話番号が未登録の会員が {missingPhoneCount} 名います。B2クラウドでは電話番号が必須のため、
            取込時にエラーになります。B2 側で入力するか、会員に登録を依頼してください。
          </p>
        )}

        {shippableCount === 0 ? (
          <span className="inline-flex cursor-not-allowed items-center justify-center rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-500">
            対象なし
          </span>
        ) : (
          <a
            href={href}
            className="inline-flex items-center justify-center rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-700"
          >
            {shippableCount} 件のB2用CSVをダウンロード
          </a>
        )}

        <p className="text-[11px] leading-relaxed text-slate-400">
          ※ 列構成はグッズ発送（注文管理 → 発送）のB2用CSVと同じです。B2クラウドに保存済みの取込設定をそのまま使えます。
          お客様管理番号には会員番号（RR-000123）が入ります。
        </p>
      </CardBody>
    </Card>
  );
}
