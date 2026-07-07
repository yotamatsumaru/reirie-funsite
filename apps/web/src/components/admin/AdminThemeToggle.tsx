'use client';

import { Moon, Sun } from 'lucide-react';
import { useAdminTheme } from './AdminThemeProvider';

/**
 * 管理画面ヘッダー用のダーク/ライト切り替えボタン。
 * AdminThemeProvider の内側でのみ使用可能。
 */
export function AdminThemeToggle() {
  const { theme, toggleTheme } = useAdminTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
      aria-pressed={isDark}
      className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
      title={isDark ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
    >
      {isDark ? <Sun className="h-3.5 w-3.5" aria-hidden /> : <Moon className="h-3.5 w-3.5" aria-hidden />}
      <span>{isDark ? 'ライト' : 'ダーク'}</span>
    </button>
  );
}
