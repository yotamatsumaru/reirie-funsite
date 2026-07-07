'use client';

/**
 * 管理画面 (/admin, /super-admin) 専用のダーク/ライト切り替え。
 *
 * - 公開サイト（トップ・会員ページ）には一切影響しない。
 *   `data-admin-theme="dark"` を付与した祖先要素の内側でのみ、
 *   globals.css で定義した CSS カスタムプロパティの上書きが有効になる。
 * - 設定は localStorage ('admin-theme') に保存し、次回訪問時も復元する。
 * - SSR/CSR のちらつき (FOUC) を避けるため、初回マウント前は
 *   `visibility: hidden` にせず、代わりに useLayoutEffect 相当の
 *   同期的な属性設定を行うインラインスクリプトは使わず、
 *   軽量な useEffect 反映 + サーバー側は常にライト描画とする
 *   （管理画面は認証必須ページであり初回描画のちらつきは許容範囲）。
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'admin-theme';

interface AdminThemeContextValue {
  theme: ThemeMode;
  toggleTheme: () => void;
}

const AdminThemeContext = createContext<AdminThemeContextValue | null>(null);

function readInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    // localStorage が使えない環境（プライベートモード等）は無視してライト既定
  }
  return 'light';
}

export function AdminThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>('light');

  // マウント後に localStorage から復元（SSR とのミスマッチを避けるため useEffect で反映）
  useEffect(() => {
    setTheme(readInitialTheme());
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  return (
    <AdminThemeContext.Provider value={{ theme, toggleTheme }}>
      <div data-admin-theme={theme} className="contents">
        {children}
      </div>
    </AdminThemeContext.Provider>
  );
}

export function useAdminTheme(): AdminThemeContextValue {
  const ctx = useContext(AdminThemeContext);
  if (!ctx) {
    throw new Error('useAdminTheme は AdminThemeProvider の内側で使用してください');
  }
  return ctx;
}
