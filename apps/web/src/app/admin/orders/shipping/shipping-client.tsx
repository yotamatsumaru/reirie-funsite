'use client';

import { useCallback, useRef, useState } from 'react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface MatchedRow {
  orderNumber: string;
  trackingNumber: string;
  orderId: string;
  status: string;
  shippingName: string;
  alreadyShipped: boolean;
  shippable: boolean;
}
interface UnmatchedRow {
  orderNumber: string;
  trackingNumber: string;
}
interface ImportResponse {
  matched: MatchedRow[];
  unmatched: UnmatchedRow[];
  skipped: number[];
}

interface ConfirmResultRow {
  orderNumber: string;
  trackingNumber: string;
  status: 'shipped' | 'not_found' | 'not_shippable' | 'error';
  message?: string;
  emailSent?: boolean;
}
interface ConfirmResponse {
  shipped: number;
  emailed: number;
  total: number;
  results: ConfirmResultRow[];
}

const CONFIRM_STATUS_LABEL: Record<ConfirmResultRow['status'], string> = {
  shipped: '発送済み',
  not_found: '注文なし',
  not_shippable: '対象外',
  error: 'エラー',
};

export function ShippingClient() {
  const [importing, setImporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<ImportResponse | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [confirmResult, setConfirmResult] = useState<ConfirmResponse | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const shippableRows = preview?.matched.filter((m) => m.shippable) ?? [];

  const handleFile = useCallback(async (file: File) => {
    setParseError(null);
    setPreview(null);
    setConfirmResult(null);
    setFileName(file.name);
    setImporting(true);
    try {
      // Shift_JIS で出力される B2 CSV も考慮しつつ、まず UTF-8 で読む。
      // 文字化けは管理番号/送り状番号 (半角英数字) には影響しないため許容。
      const text = await file.text();
      const res = await fetch('/api/admin/orders/shipping/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setParseError(data?.error ?? 'CSVの取り込みに失敗しました');
        return;
      }
      setPreview(data as ImportResponse);
    } catch {
      setParseError('CSVの読み込みに失敗しました');
    } finally {
      setImporting(false);
    }
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  };

  const onConfirm = async () => {
    if (shippableRows.length === 0) return;
    setConfirming(true);
    setConfirmResult(null);
    try {
      const res = await fetch('/api/admin/orders/shipping/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: shippableRows.map((r) => ({
            orderNumber: r.orderNumber,
            trackingNumber: r.trackingNumber,
          })),
          notifyCustomer,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setParseError(data?.error ?? '発送処理に失敗しました');
        return;
      }
      setConfirmResult(data as ConfirmResponse);
      // 成功後はプレビューをクリアして二重発送を防ぐ。
      setPreview(null);
      setFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch {
      setParseError('発送処理に失敗しました');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* STEP 1: 送り状発行データ (配送先) の書き出し */}
      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
              1
            </span>
            <h2 className="text-base font-bold text-slate-800">送り状データを書き出す</h2>
          </div>
          <p className="text-sm text-slate-600">
            未発送 (入金済み / 処理中) の注文の配送先を、ヤマト「B2クラウド」取込用CSVで
            ダウンロードします。送り状種類=<b>発払い</b>・クール区分=<b>通常</b> (宅急便) 固定です。
          </p>
          <a href="/api/admin/orders/shipping/export" download>
            <Button variant="primary">送り状CSVをダウンロード</Button>
          </a>
          <p className="text-xs text-slate-500">
            ダウンロードしたCSVを B2クラウドの「送り状発行 → 外部データ取込」から取り込み、
            「お客様管理番号」に注文番号が入る列マッピングを保存してください
            (次回以降は同じ設定で取り込めます)。取込後に送り状を印刷して発送します。
          </p>
        </CardBody>
      </Card>

      {/* STEP 2: 送り状番号CSVの取り込み (プレビュー) */}
      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
              2
            </span>
            <h2 className="text-base font-bold text-slate-800">送り状番号CSVを取り込む</h2>
          </div>
          <p className="text-sm text-slate-600">
            B2クラウドが出力した「発送予定データ」CSV
            (お客様管理番号 + 送り状番号) をアップロードすると、注文番号で突き合わせて
            発送対象を一覧表示します。
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={onFileChange}
              className="block text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
            />
            {importing && <span className="text-sm text-slate-500">読み込み中…</span>}
            {fileName && !importing && (
              <span className="text-xs text-slate-500">{fileName}</span>
            )}
          </div>
          {parseError && (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{parseError}</p>
          )}
        </CardBody>
      </Card>

      {/* プレビュー結果 */}
      {preview && (
        <Card>
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge tone="success">発送可能 {shippableRows.length}</Badge>
              <Badge tone="info">照合 {preview.matched.length}</Badge>
              {preview.unmatched.length > 0 && (
                <Badge tone="danger">注文なし {preview.unmatched.length}</Badge>
              )}
              {preview.skipped.length > 0 && (
                <Badge tone="gray">スキップ行 {preview.skipped.length}</Badge>
              )}
            </div>

            {preview.matched.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">注文番号</th>
                      <th className="px-3 py-2">お届け先</th>
                      <th className="px-3 py-2">送り状番号</th>
                      <th className="px-3 py-2">状態</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {preview.matched.map((m) => (
                      <tr key={m.orderNumber} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-mono text-xs">{m.orderNumber}</td>
                        <td className="px-3 py-2">{m.shippingName}</td>
                        <td className="px-3 py-2 font-mono text-xs">{m.trackingNumber}</td>
                        <td className="px-3 py-2">
                          {m.shippable ? (
                            <Badge tone="success">発送可</Badge>
                          ) : m.alreadyShipped ? (
                            <Badge tone="gray">発送済み</Badge>
                          ) : (
                            <Badge tone="danger">{m.status}</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {preview.unmatched.length > 0 && (
              <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <p className="font-semibold">注文が見つからなかった管理番号:</p>
                <p className="font-mono">
                  {preview.unmatched.map((u) => u.orderNumber).join(', ')}
                </p>
              </div>
            )}

            {/* STEP 3: 一括発送確定 + 通知 */}
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                  3
                </span>
                <h2 className="text-base font-bold text-slate-800">一括で発送を確定する</h2>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={notifyCustomer}
                  onChange={(e) => setNotifyCustomer(e.target.checked)}
                />
                発送通知メールを送る
              </label>
              <p className="text-xs text-slate-500">
                発送可能な {shippableRows.length} 件を「発送済み」に更新し、送り状番号を保存します。
                在庫の引当も確定します (この操作は取り消せません)。
              </p>
              <Button
                variant="primary"
                onClick={onConfirm}
                loading={confirming}
                disabled={shippableRows.length === 0}
              >
                {shippableRows.length} 件を発送確定する
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* 確定結果 */}
      {confirmResult && (
        <Card>
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge tone="success">発送 {confirmResult.shipped}</Badge>
              <Badge tone="info">通知メール {confirmResult.emailed}</Badge>
              <Badge tone="gray">対象 {confirmResult.total}</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">注文番号</th>
                    <th className="px-3 py-2">送り状番号</th>
                    <th className="px-3 py-2">結果</th>
                    <th className="px-3 py-2">メール</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {confirmResult.results.map((r) => (
                    <tr key={r.orderNumber} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono text-xs">{r.orderNumber}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.trackingNumber}</td>
                      <td className="px-3 py-2">
                        {r.status === 'shipped' ? (
                          <Badge tone="success">{CONFIRM_STATUS_LABEL[r.status]}</Badge>
                        ) : (
                          <Badge tone="danger">
                            {CONFIRM_STATUS_LABEL[r.status]}
                            {r.message ? `: ${r.message}` : ''}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {r.status === 'shipped' ? (r.emailSent ? '送信' : '—') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
