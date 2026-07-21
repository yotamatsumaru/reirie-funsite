/**
 * Member Summary Store (Zustand)
 *
 * サイドバーに表示する「プラン / 会員ランク / 保有ポイント」を保持する軽量ストア。
 * - ログイン時にサイドバーが自動取得
 * - ログインボーナス受取・ミニゲーム・景品交換など、ポイントが変動する操作の直後に
 *   各クライアントコンポーネントから `useMemberSummaryStore.getState().fetchSummary()`
 *   を呼ぶことで、ページ遷移なしにサイドバーの表示も最新化できる。
 */
'use client';

import { create } from 'zustand';
import type { MemberRank } from '@idol/shared';

export interface MemberSummary {
  plan: 'FREE' | 'STANDARD' | 'PREMIUM';
  rank: MemberRank;
  points: number;
}

interface MemberSummaryState {
  summary: MemberSummary | null;
  loading: boolean;
  fetchSummary: () => Promise<void>;
  clear: () => void;
}

export const useMemberSummaryStore = create<MemberSummaryState>()((set) => ({
  summary: null,
  loading: false,

  fetchSummary: async () => {
    set({ loading: true });
    try {
      const res = await fetch('/api/me/summary', { credentials: 'include' });
      if (!res.ok) {
        set({ loading: false });
        return;
      }
      const data = (await res.json()) as MemberSummary;
      set({ summary: data, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  clear: () => set({ summary: null }),
}));

/** サイドバー等で使う会員概要のセレクタ */
export const useMemberSummary = () => useMemberSummaryStore((s) => s.summary);
