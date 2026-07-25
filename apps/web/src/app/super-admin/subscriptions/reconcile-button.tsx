/**
 * Stripe ⇔ DB サブスク再照合ボタン (Client Component)
 *  - Stripe 上のサブスクを正として DB の Subscription を一括 upsert する。
 *  - Webhook の取りこぼし (customer.subscription.* 未購読等) で、売上には出るのに
 *    サブスク分析に反映されないケースを一括復旧するための管理操作。
 */
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

type ReconcileResult = {
  ok: boolean;
  processed: number;
  created: number;
  updated: number;
  skippedNoUser: number;
  skippedNoPrice: number;
};

export function ReconcileButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReconcileResult | null>(null);

  async function run() {
    if (loading || pending) return;
    if (
      !window.confirm(
        'Stripe 上の実際のサブスクリプションを取得し、DB のサブスク一覧を最新化します。\n' +
          '（Webフックの取りこぼしで売上には出ているのにサブスクに反映されない契約を復旧します）\n\n実行しますか？',
      )
    ) {
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch('/api/super-admin/subscriptions/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const j = (await res.json().catch(() => ({}))) as
        | ReconcileResult
        | { error?: { message?: string } };
      if (!res.ok || !(j as ReconcileResult).ok) {
        setError((j as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`);
        return;
      }
      setResult(j as ReconcileResult);
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const busy = loading || pending;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
        {busy ? '再照合中…' : 'Stripe と再照合'}
      </button>
      {result && (
        <p className="text-right text-xs text-emerald-700">
          完了: 取得 {result.processed} / 新規 {result.created} / 更新 {result.updated}
          {result.skippedNoUser > 0 && (
            <span className="text-amber-600">
              {' '}
              / ユーザー未特定 {result.skippedNoUser}
            </span>
          )}
        </p>
      )}
      {error && <p className="text-right text-xs text-rose-600">エラー: {error}</p>}
    </div>
  );
}
