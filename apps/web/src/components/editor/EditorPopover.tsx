'use client';

/**
 * エディタのツールバー直下に出す小さな入力パネル。
 *
 * window.prompt を置き換えるためのもの。prompt には
 *   - 見た目がブラウザ依存でサイトの UI から浮く
 *   - 入力中に元のテキスト選択が見えない
 *   - スマホだと画面上部に小さく出て押しづらい
 *   - Safari の「このページにこれ以上ダイアログを表示しない」で無効化される
 * という問題があり、「入力しやすい UI」の要望に反するため。
 */
import { useEffect, useRef, type ReactNode } from 'react';

export function EditorPopover({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Esc で閉じる / パネル外クリックで閉じる
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('keydown', onKey);
    // mousedown だとツールバーのボタン押下と競合するので click を使う
    document.addEventListener('click', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onPointerDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      className="border-b border-slate-200 bg-brand-50/60 px-3 py-2"
    >
      <p className="mb-1.5 text-[11px] font-semibold text-slate-600">{title}</p>
      {children}
    </div>
  );
}
