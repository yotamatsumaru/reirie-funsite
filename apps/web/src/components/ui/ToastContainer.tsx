'use client';

import { useUiStore } from '@/stores/ui-store';

const VARIANT_STYLES: Record<string, string> = {
  info: 'bg-slate-800 text-white',
  success: 'bg-emerald-600 text-white',
  warning: 'bg-amber-500 text-white',
  error: 'bg-rose-600 text-white',
};

export function ToastContainer() {
  const toasts = useUiStore((s) => s.toasts);
  const remove = useUiStore((s) => s.removeToast);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 safe-bottom"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto w-full max-w-sm rounded-lg px-4 py-3 shadow-lg ${VARIANT_STYLES[t.variant] ?? VARIANT_STYLES.info}`}
          role="status"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              {t.title && <p className="text-sm font-semibold">{t.title}</p>}
              <p className="text-sm leading-relaxed">{t.message}</p>
            </div>
            <button
              type="button"
              aria-label="閉じる"
              onClick={() => remove(t.id)}
              className="text-white/80 hover:text-white"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
