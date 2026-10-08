/**
 * Cart Store (Zustand)
 *
 * - サーバの /api/cart と同期する Client State
 * - Optimistic update (追加/数量変更/削除) で UX を高速化
 * - 認証必須 (未ログイン時は何もしない)
 */
'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface CartLineItem {
  id: string;
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  variantName: string;
  /** サイズ・カラーを含む表示用ラベル (例:「ホワイト / L」) */
  variantLabel?: string;
  optionSize?: string | null;
  optionColor?: string | null;
  /** 商品オプション (宛名など) の入力値 */
  optionValues?: { optionId: string; name: string; value: string; price: number }[];
  /** 表示用: 「宛名: れいり / 言葉: ありがとう」 */
  optionLabel?: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  thumbnailUrl: string | null;
  inStock: boolean;
  available: number;
  blocked: false | { reason: string };
}

export interface CartTotals {
  subtotal: number;
  taxAmount: number;
  shippingFee: number;
  totalAmount: number;
}

/** カート内の全商品が対応する配送方法 (購入者が選ぶ) */
export interface CartShippingOption {
  id: string;
  name: string;
  description: string | null;
  fee: number;
}

export interface CartShipping {
  candidates: CartShippingOption[];
  /** 現在選択中 (サーバーが確定した) 配送方法 id */
  selectedId: string | null;
  /** 送料無料になる小計 (0 = 常時無料) */
  freeShippingThreshold: number;
}

interface CartState {
  cartId: string | null;
  items: CartLineItem[];
  totals: CartTotals;
  shipping: CartShipping;
  loading: boolean;
  error: string | null;
  // actions
  fetchCart: () => Promise<void>;
  addItem: (
    variantId: string,
    quantity: number,
    options?: Record<string, string>,
  ) => Promise<void>;
  updateItem: (itemId: string, quantity: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  /** 配送方法を選ぶ (サーバーで送料を再計算する) */
  selectShipping: (shippingMethodId: string) => Promise<void>;
  clear: () => void;
}

const emptyTotals: CartTotals = {
  subtotal: 0,
  taxAmount: 0,
  shippingFee: 0,
  totalAmount: 0,
};

const emptyShipping: CartShipping = {
  candidates: [],
  selectedId: null,
  freeShippingThreshold: 0,
};

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      cartId: null,
      items: [],
      totals: emptyTotals,
      shipping: emptyShipping,
      loading: false,
      error: null,

      fetchCart: async () => {
        set({ loading: true, error: null });
        try {
          // 選択済みの配送方法を維持したまま再取得する (数量変更で選択がリセットされないように)
          const selected = get().shipping.selectedId;
          const qs = selected ? `?shippingMethodId=${encodeURIComponent(selected)}` : '';
          const res = await fetch(`/api/cart${qs}`, { credentials: 'include' });
          if (res.status === 401) {
            set({
              cartId: null,
              items: [],
              totals: emptyTotals,
              shipping: emptyShipping,
              loading: false,
            });
            return;
          }
          if (!res.ok) throw new Error('カート取得に失敗しました');
          const data = await res.json();
          set({
            cartId: data.cartId,
            items: data.items,
            totals: {
              subtotal: data.subtotal,
              taxAmount: data.taxAmount,
              shippingFee: data.shippingFee,
              totalAmount: data.totalAmount,
            },
            shipping: data.shipping ?? emptyShipping,
            loading: false,
          });
        } catch (e) {
          set({ loading: false, error: (e as Error).message });
        }
      },

      addItem: async (variantId, quantity, options) => {
        set({ loading: true, error: null });
        try {
          const res = await fetch('/api/cart/items', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ variantId, quantity, ...(options ? { options } : {}) }),
          });
          if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            throw new Error(json?.error?.message ?? 'カート追加に失敗しました');
          }
          await get().fetchCart();
        } catch (e) {
          set({ loading: false, error: (e as Error).message });
          throw e;
        }
      },

      updateItem: async (itemId, quantity) => {
        // optimistic
        const prev = get().items;
        set({
          items: prev.map((it) =>
            it.id === itemId ? { ...it, quantity, subtotal: it.unitPrice * quantity } : it,
          ),
        });
        try {
          const res = await fetch(`/api/cart/items/${itemId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ quantity }),
          });
          if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            throw new Error(json?.error?.message ?? '更新に失敗しました');
          }
          await get().fetchCart();
        } catch (e) {
          // rollback
          set({ items: prev, error: (e as Error).message });
          throw e;
        }
      },

      removeItem: async (itemId) => {
        const prev = get().items;
        set({ items: prev.filter((i) => i.id !== itemId) });
        try {
          const res = await fetch(`/api/cart/items/${itemId}`, {
            method: 'DELETE',
            credentials: 'include',
          });
          if (!res.ok) throw new Error('削除に失敗しました');
          await get().fetchCart();
        } catch (e) {
          set({ items: prev, error: (e as Error).message });
          throw e;
        }
      },

      selectShipping: async (shippingMethodId) => {
        // 先にローカルの選択を更新してからサーバーで送料を再計算する
        set({ shipping: { ...get().shipping, selectedId: shippingMethodId } });
        await get().fetchCart();
      },

      clear: () =>
        set({
          cartId: null,
          items: [],
          totals: emptyTotals,
          shipping: emptyShipping,
          error: null,
        }),
    }),
    {
      name: 'idol-cart',
      storage: createJSONStorage(() => localStorage),
      // persist は totals / items / shipping のみ (loading/error は除外)
      partialize: (s) => ({
        cartId: s.cartId,
        items: s.items,
        totals: s.totals,
        shipping: s.shipping,
      }),
    },
  ),
);

/** カート内アイテム数 (バッジ表示用) */
export const useCartItemCount = () =>
  useCartStore((s) => s.items.reduce((sum, i) => sum + i.quantity, 0));
