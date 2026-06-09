/**
 * サブスク行の操作 (Client Component)
 *  - 強制解約 (即時)
 *  - 期末解約予約のトグル
 */
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function SubRowActions({
  subId,
  status,
  cancelAtPeriodEnd,
}: {
  subId: string;
  status: string;
  cancelAtPeriodEnd: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isCanceled = status === 'CANCELED';

  async function callApi(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/super-admin/subscriptions/${subId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(j.error?.message ?? `HTTP ${res.status}`);
      return false;
    }
    return true;
  }

  function handleCancelImmediate() {
    if (!confirm('この契約を即時解約しますか？(返金は別途処理が必要)')) return;
    startTransition(async () => {
      const ok = await callApi({ action: 'cancel_immediate' });
      if (ok) router.refresh();
    });
  }

  function handleCancelAtPeriodEnd() {
    const next = !cancelAtPeriodEnd;
    const msg = next
      ? '期末で解約を予約しますか？'
      : '期末解約の予約を取り消しますか？';
    if (!confirm(msg)) return;
    startTransition(async () => {
      const ok = await callApi({ action: 'cancel_at_period_end', value: next });
      if (ok) router.refresh();
    });
  }

  if (isCanceled) {
    return <span className="text-xs text-slate-400">— 操作不可</span>;
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={handleCancelAtPeriodEnd}
        disabled={pending}
        className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
      >
        {cancelAtPeriodEnd ? '予約解除' : '期末解約'}
      </button>
      <button
        type="button"
        onClick={handleCancelImmediate}
        disabled={pending}
        className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
      >
        即時解約
      </button>
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}
