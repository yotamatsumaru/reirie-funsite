/**
 * プレゼントパネル (確定報酬型 DLC — ガチャではない)
 *
 * - 所持アイテム一覧から贈るものを選択
 * - 親密度 boost が "確定" であることを明記 (景表法対応)
 * - 未所持アイテムは購入導線へ
 */
'use client';

import { useState } from 'react';

export interface GiftItem {
  id: string;
  slug: string;
  name: string;
  iconUrl?: string | null;
  affinityBoost: number;
  description?: string | null;
  /** 所持数 (>0 で贈れる) */
  owned: number;
  /** 単価 (購入導線用) */
  priceJpy: number;
  isPremiumOnly: boolean;
}

export interface GiftPanelProps {
  open: boolean;
  items: GiftItem[];
  onClose: () => void;
  onGive: (item: GiftItem) => Promise<void> | void;
  onBuy: (item: GiftItem) => void;
}

export function GiftPanel({ open, items, onClose, onGive, onBuy }: GiftPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-pink-100 bg-gradient-to-r from-pink-50 to-rose-50 px-5 py-3">
          <h2 className="text-lg font-bold text-slate-900">🎁 プレゼントを贈る</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100"
            aria-label="閉じる"
          >
            ✕
          </button>
        </header>
        <div className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-800">
          ※ プレゼントによる親密度上昇は<strong>確定</strong>です。ランダム要素はありません。
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-4 sm:p-5">
          {items.length === 0 && (
            <p className="py-12 text-center text-sm text-slate-500">
              まだプレゼントを所持していません。
            </p>
          )}
          <ul className="space-y-2">
            {items.map((it) => (
              <li
                key={it.id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3"
              >
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md bg-pink-100 text-2xl">
                  {it.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.iconUrl} alt="" className="h-12 w-12 rounded-md object-cover" />
                  ) : (
                    '🎁'
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{it.name}</p>
                  <p className="text-xs text-slate-500">
                    親密度 +{it.affinityBoost} ／ 所持 {it.owned}
                    {it.isPremiumOnly && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
                        PREMIUM 限定
                      </span>
                    )}
                  </p>
                </div>
                {it.owned > 0 ? (
                  <button
                    type="button"
                    disabled={busy === it.id}
                    onClick={async () => {
                      setBusy(it.id);
                      try {
                        await onGive(it);
                      } finally {
                        setBusy(null);
                      }
                    }}
                    className="min-h-[40px] rounded-md bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50 sm:text-sm"
                  >
                    {busy === it.id ? '…' : '贈る'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onBuy(it)}
                    className="min-h-[40px] rounded-md border border-pink-300 bg-pink-50 px-3 py-2 text-xs font-semibold text-pink-700 hover:bg-pink-100 sm:text-sm"
                  >
                    ¥{it.priceJpy.toLocaleString()} で購入
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
