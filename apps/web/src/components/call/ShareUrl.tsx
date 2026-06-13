'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function ShareUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 古いブラウザ向けフォールバック
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } finally {
        document.body.removeChild(ta);
      }
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <code className="flex-1 truncate font-mono text-xs text-slate-700">{url}</code>
      <button
        type="button"
        onClick={() => void onCopy()}
        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200"
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
            コピー済み
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" aria-hidden />
            URL をコピー
          </>
        )}
      </button>
    </div>
  );
}
