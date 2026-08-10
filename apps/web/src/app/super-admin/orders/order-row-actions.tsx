'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useSuperAdminReadOnly } from '@/components/admin/SuperAdminReadOnly';

export function OrderRowActions({
  orderId,
  status,
}: {
  orderId: string;
  status: string;
}) {
  const router = useRouter();
  const readOnly = useSuperAdminReadOnly();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function callApi(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/super-admin/orders/${orderId}`, {
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

  function handleRefund() {
    if (!confirm('この注文を返金処理しますか？(Stripe API も別途処理が必要)')) return;
    startTransition(async () => {
      const ok = await callApi({ action: 'refund' });
      if (ok) router.refresh();
    });
  }

  function handleShip() {
    const tracking = prompt('追跡番号を入力してください (省略可)') ?? '';
    startTransition(async () => {
      const ok = await callApi({ action: 'ship', trackingNumber: tracking || null });
      if (ok) router.refresh();
    });
  }

  function handleCancel() {
    if (!confirm('この注文をキャンセルしますか？')) return;
    startTransition(async () => {
      const ok = await callApi({ action: 'cancel' });
      if (ok) router.refresh();
    });
  }

  const canRefund = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(status);
  const canShip = ['PAID', 'PROCESSING'].includes(status);
  const canCancel = ['PENDING', 'PAID', 'PROCESSING'].includes(status);

  if (status === 'REFUNDED' || status === 'CANCELED') {
    return <span className="text-xs text-slate-400">— 完了</span>;
  }

  // スタッフ管理者 (STAFF) は閲覧のみ。返金・発送・キャンセルは実行できない。
  // (API 側も requireSuperAdmin() で 403 になるが、押せないボタンを見せない)
  if (readOnly) {
    return <span className="text-[11px] text-slate-400">閲覧のみ</span>;
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {canShip && (
        <button
          type="button"
          onClick={handleShip}
          disabled={pending}
          className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
        >
          発送
        </button>
      )}
      {canCancel && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={pending}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          キャンセル
        </button>
      )}
      {canRefund && (
        <button
          type="button"
          onClick={handleRefund}
          disabled={pending}
          className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
        >
          返金
        </button>
      )}
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}
