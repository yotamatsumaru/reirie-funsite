/**
 * UI Store (Zustand)
 *  - グローバルなトースト通知
 *  - サイドメニュー開閉
 *  - モーダル管理
 */
'use client';

import { create } from 'zustand';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  variant: ToastVariant;
  title?: string;
  message: string;
  durationMs: number;
}

interface UiState {
  toasts: Toast[];
  menuOpen: boolean;
  pushToast: (t: Omit<Toast, 'id' | 'durationMs'> & { durationMs?: number }) => string;
  removeToast: (id: string) => void;
  setMenuOpen: (open: boolean) => void;
  toggleMenu: () => void;
}

let toastSeq = 0;
const nextId = () => `t-${Date.now()}-${++toastSeq}`;

export const useUiStore = create<UiState>((set, get) => ({
  toasts: [],
  menuOpen: false,
  pushToast: ({ durationMs = 4000, ...rest }) => {
    const id = nextId();
    const toast: Toast = { id, durationMs, ...rest };
    set({ toasts: [...get().toasts, toast] });
    if (durationMs > 0 && typeof window !== 'undefined') {
      window.setTimeout(() => {
        set({ toasts: get().toasts.filter((t) => t.id !== id) });
      }, durationMs);
    }
    return id;
  },
  removeToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setMenuOpen: (open) => set({ menuOpen: open }),
  toggleMenu: () => set({ menuOpen: !get().menuOpen }),
}));

export const toast = {
  info: (message: string, title?: string) =>
    useUiStore.getState().pushToast({ variant: 'info', message, title }),
  success: (message: string, title?: string) =>
    useUiStore.getState().pushToast({ variant: 'success', message, title }),
  warning: (message: string, title?: string) =>
    useUiStore.getState().pushToast({ variant: 'warning', message, title }),
  error: (message: string, title?: string) =>
    useUiStore.getState().pushToast({ variant: 'error', message, title }),
};
