/**
 * 章購入ボタン (Stripe Checkout 起動)
 */
'use client';

import { useState } from 'react';

export function ChapterPurchaseButton({
  scenarioId,
  priceJpy,
}: {
  scenarioId: string;
  priceJpy: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/game/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          kind: 'SCENARIO',
          scenarioId,
          quantity: 1,
          successUrl: `${window.location.origin}/game/play/${scenarioId}`,
          cancelUrl: window.location.href,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? '購入手続きに失敗しました');
      }
      const data = await res.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error('Checkout URL が取得できませんでした');
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="inline-flex min-h-[40px] items-center rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
      >
        {busy ? '読み込み中…' : `¥${priceJpy.toLocaleString()} で購入`}
      </button>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
