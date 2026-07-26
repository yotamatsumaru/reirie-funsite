'use client';

/**
 * Pui パック購入の未付与是正 (再照合) クライアント UI
 *  - 「検出する」で Stripe 照合のプレビュー (書き込みなし)
 *  - 「支払い済みを付与する」で確定 (Pui 付与)
 */
import { useState } from 'react';
import { formatJstDateTime } from '@idol/shared';

type Candidate = {
  purchaseId: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  packName: string | null;
  pui: number;
  amountJpy: number;
  status: string;
  createdAt: string;
  stripePaid: boolean;
  stripeDetail: string;
};

type Preview = {
  total: number;
  grantableCount: number;
  grantablePui: number;
  candidates: Candidate[];
};

type ApplyResult = {
  ok: boolean;
  grantedCount: number;
  grantedPui: number;
  processed: number;
  results: Array<{
    purchaseId: string;
    userId: string;
    pui: number;
    granted: boolean;
    reason?: string;
    balance?: number;
  }>;
};

const ENDPOINT = '/api/super-admin/reward-point-packs/reconcile';

export function ReconcileClient() {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [applied, setApplied] = useState<ApplyResult | null>(null);

  async function runPreview() {
    setLoading(true);
    setError(null);
    setApplied(null);
    try {
      const res = await fetch(ENDPOINT, { method: 'GET' });
      if (!res.ok) throw new Error(`検出に失敗しました (${res.status})`);
      const data = (await res.json()) as Preview;
      setPreview(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function runApply() {
    if (!preview || preview.grantableCount === 0) return;
    if (
      !window.confirm(
        `支払い済みの ${preview.grantableCount} 件（合計 ${preview.grantablePui.toLocaleString()} Pui）を付与します。よろしいですか？\n（既に付与済みのものは二重付与されません）`,
      )
    ) {
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`付与に失敗しました (${res.status})`);
      const data = (await res.json()) as ApplyResult;
      setApplied(data);
      // 付与後に再プレビューして残りを更新
      await runPreview();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={runPreview}
          disabled={loading || applying}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? '検出中…' : '未付与を検出する'}
        </button>
        <button
          type="button"
          onClick={runApply}
          disabled={applying || loading || !preview || preview.grantableCount === 0}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {applying
            ? '付与中…'
            : preview
              ? `支払い済み ${preview.grantableCount} 件に Pui を付与する`
              : '支払い済みに Pui を付与する'}
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {applied && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {applied.grantedCount} 件・合計 {applied.grantedPui.toLocaleString()} Pui を付与しました。
        </p>
      )}

      {preview && (
        <div className="space-y-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            未確定の購入 <b>{preview.total}</b> 件を検出。うち Stripe 上「支払い済み」で
            <b className="text-emerald-700"> 付与できるのは {preview.grantableCount} 件</b>
            （合計 <b>{preview.grantablePui.toLocaleString()} Pui</b>）です。
          </div>

          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2">会員</th>
                  <th className="px-3 py-2">パック</th>
                  <th className="px-3 py-2 text-right">Pui</th>
                  <th className="px-3 py-2 text-right">金額</th>
                  <th className="px-3 py-2">DB状態</th>
                  <th className="px-3 py-2">Stripe</th>
                  <th className="px-3 py-2">購入日時</th>
                </tr>
              </thead>
              <tbody>
                {preview.candidates.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                      未付与の購入はありません。
                    </td>
                  </tr>
                )}
                {preview.candidates.map((c) => (
                  <tr
                    key={c.purchaseId}
                    className={
                      c.stripePaid
                        ? 'border-t border-slate-100 bg-emerald-50/40'
                        : 'border-t border-slate-100'
                    }
                  >
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800">
                        {c.userName ?? '（不明）'}
                      </p>
                      <p className="text-xs text-slate-500">{c.userEmail ?? '—'}</p>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{c.packName ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {c.pui.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      ¥{c.amountJpy.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">{c.status}</td>
                    <td className="px-3 py-2">
                      {c.stripePaid ? (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-emerald-700">
                          支払い済み
                        </span>
                      ) : (
                        <span
                          className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500"
                          title={c.stripeDetail}
                        >
                          未確認
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {formatJstDateTime(c.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
