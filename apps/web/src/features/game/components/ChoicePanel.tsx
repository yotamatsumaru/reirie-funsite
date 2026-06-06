/**
 * 選択肢パネル (Ace Attorney 風コマンド UI)
 */
'use client';

import type { ChoiceView } from '../engine/types';

export interface ChoicePanelProps {
  prompt?: string;
  choices: ChoiceView[];
  onSelect: (index: number) => void;
}

export function ChoicePanel({ prompt, choices, onSelect }: ChoicePanelProps) {
  const visible = choices.filter((c) => !c.hidden);
  if (visible.length === 0) return null;
  return (
    <div className="absolute inset-x-0 bottom-0 z-20">
      <div
        className="mx-auto w-full max-w-2xl rounded-t-2xl border border-pink-300/60 bg-gradient-to-b from-pink-50 to-white px-5 py-5 shadow-2xl sm:px-8"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {prompt && (
          <p className="mb-3 text-center text-sm font-semibold text-slate-700 sm:text-base">
            {prompt}
          </p>
        )}
        <div className="space-y-2">
          {visible.map((c) => (
            <button
              key={c.index}
              type="button"
              disabled={c.locked}
              onClick={() => !c.locked && onSelect(c.index)}
              className={[
                'group flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
                c.locked
                  ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                  : 'border-pink-300 bg-white text-slate-900 hover:border-brand-600 hover:bg-pink-50',
              ].join(' ')}
            >
              <span className="text-sm sm:text-base">
                {c.label}
                {c.locked && c.lockReason === 'premiumOnly' && (
                  <span className="ml-2 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                    PREMIUM 限定
                  </span>
                )}
                {c.locked && c.lockReason === 'requireItem' && (
                  <span className="ml-2 inline-block rounded bg-rose-100 px-2 py-0.5 text-xs text-rose-700">
                    アイテム必要
                  </span>
                )}
              </span>
              {!c.locked && <span className="text-pink-400 group-hover:text-brand-600">→</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
