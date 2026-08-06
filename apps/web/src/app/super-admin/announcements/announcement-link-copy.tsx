'use client';

/**
 * お知らせの公開 URL をコピーするボタン
 *
 * 用途:
 *   LivePocket など外部サービスの「アクセス元制限」に登録するため、
 *   お知らせの URL / サイトのドメインを控える必要がある。
 *   毎回手で打つと打ち間違えて弾かれるのでコピーできるようにする。
 *
 * clipboard API は https / localhost でしか使えないため、
 * 失敗時は `<input>` を選択状態にして手動コピーへフォールバックする。
 */

import { useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function AnnouncementLinkCopy({
  url,
  label = 'URL をコピー',
  hint,
}: {
  url: string;
  label?: string;
  hint?: string;
}) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // http アクセス時や権限拒否時は選択状態にして手動コピーを促す
      inputRef.current?.select();
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-700"
        />
        <button
          type="button"
          onClick={copy}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
              コピーしました
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" aria-hidden />
              {label}
            </>
          )}
        </button>
      </div>
      {hint && <p className="text-[10px] leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}
