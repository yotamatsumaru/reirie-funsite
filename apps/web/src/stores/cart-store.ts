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

interface CartState {
  cartId: string | null;
  items: CartLineItem[];
  totals: CartTotals;
  loading: boolean;
  error: string | null;
  // actions
  fetchCart: () => Promise<void>;
  addItem: (variantId: string, quantity: number) => Promise<void>;
  updateItem: (itemId: string, quantity: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  clear: () => void;
}

const emptyTotals: CartTotals = {
  subtotal: 0,
  taxAmount: 0,
  shippingFee: 0,
  totalAmount: 0,
};

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      cartId: null,
      items: [],
      totals: emptyTotals,
      loading: false,
      error: null,

      fetchCart: async () => {
        set({ loading: true, error: null });
        try {
          const res = await fetch('/api/cart', { credentials: 'include' });
          if (res.status === 401) {
            set({ cartId: null, items: [], totals: emptyTotals, loading: false });
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
            loading: false,
          });
        } catch (e) {
          set({ loading: false, error: (e as Error).message });
        }
      },

      addItem: async (variantId, quantity) => {
        set({ loading: true, error: null });
        try {
          const res = await fetch('/api/cart/items', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ variantId, quantity }),
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

      clear: () => set({ cartId: null, items: [], totals: emptyTotals, error: null }),
    }),
    {
      name: 'idol-cart',
      storage: createJSONStorage(() => localStorage),
      // persist は totals と items のみ (loading/error は除外)
      partialize: (s) => ({ cartId: s.cartId, items: s.items, totals: s.totals }),
    },
  ),
);

/** カート内アイテム数 (バッジ表示用) */
export const useCartItemCount = () =>
  useCartStore((s) => s.items.reduce((sum, i) => sum + i.quantity, 0));
