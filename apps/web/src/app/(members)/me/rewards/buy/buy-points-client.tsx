'use client';

/**
 * 特典ポイントパック購入ボタン (Stripe Checkout 起動)
 */
import { useState } from 'react';

type Pack = {
  id: string;
  name: string;
  points: number;
  priceJpy: number;
};

export function BuyPointsClient({ packs }: { packs: Pack[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleBuy = async (packId: string) => {
    setError(null);
    setBusyId(packId);
    try {
      const origin = window.location.origin;
      const res = await fetch('/api/me/reward-points/purchase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          packId,
          successUrl: `${origin}/me/rewards/buy/success`,
          cancelUrl: `${origin}/me/rewards/buy?canceled=1`,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? '購入手続きに失敗しました');
      }
      const data = (await res.json()) as { checkoutUrl?: string };
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error('Checkout URL が取得できませんでした');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '不明なエラーが発生しました');
      setBusyId(null);
    }
  };

  if (packs.length === 0) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
        現在購入可能な特典ポイントパックはありません。
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {packs.map((pack) => {
          const unitPrice = pack.points > 0 ? pack.priceJpy / pack.points : 0;
          return (
            <div
              key={pack.id}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div>
                <p className="text-sm font-semibold text-slate-600">{pack.name}</p>
                <p className="mt-2 text-3xl font-bold text-slate-900">
                  {pack.points.toLocaleString()}
                  <span className="ml-1 text-base font-normal text-slate-500">pt</span>
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  1pt あたり ¥{unitPrice.toFixed(1)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleBuy(pack.id)}
                disabled={busyId !== null}
                className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busyId === pack.id
                  ? '読み込み中…'
                  : `¥${pack.priceJpy.toLocaleString()} で購入`}
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-400">
        決済は Stripe の安全な決済ページで行われます。購入完了後、特典ポイントは自動的に付与されます。
      </p>
    </div>
  );
}
