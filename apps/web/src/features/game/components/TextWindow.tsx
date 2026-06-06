/**
 * テキストウィンドウ (台詞 / ナレーション)
 *
 * - 一文字ずつ送るタイピング演出
 * - クリック / タップで「全文表示」→「次へ」の 2 段階
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import type { Step } from '@idol/shared';

export interface TextWindowProps {
  step: Step | null;
  onAdvance: () => void;
  /** 1 文字あたりの ms */
  charSpeedMs?: number;
}

export function TextWindow({ step, onAdvance, charSpeedMs = 24 }: TextWindowProps) {
  const text = step?.type === 'say' ? step.text : step?.type === 'narration' ? step.text : '';
  const speaker = step?.type === 'say' ? step.speaker : null;

  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepKeyRef = useRef<string>('');

  useEffect(() => {
    // step が変わったら再生し直し
    const key = JSON.stringify(step);
    if (key === stepKeyRef.current) return;
    stepKeyRef.current = key;

    if (timerRef.current) clearInterval(timerRef.current);
    setDisplayed('');
    setDone(false);

    if (!text) {
      setDone(true);
      return;
    }
    let i = 0;
    timerRef.current = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) {
        if (timerRef.current) clearInterval(timerRef.current);
        setDone(true);
      }
    }, charSpeedMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [step, text, charSpeedMs]);

  const handleClick = () => {
    if (!done) {
      // 全文即時表示
      if (timerRef.current) clearInterval(timerRef.current);
      setDisplayed(text);
      setDone(true);
      return;
    }
    onAdvance();
  };

  if (!step) return null;
  if (step.type !== 'say' && step.type !== 'narration') return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      className="absolute inset-x-0 bottom-0 z-10 cursor-pointer text-left"
      aria-label={done ? '次へ進む' : '全文を表示する'}
    >
      <div
        className="mx-auto w-full max-w-4xl rounded-t-2xl border border-white/20 bg-black/75 px-5 py-4 text-white backdrop-blur-md sm:px-8 sm:py-6"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {speaker && (
          <div className="mb-2 inline-block rounded-md bg-brand-600 px-3 py-1 text-sm font-semibold">
            {speaker}
          </div>
        )}
        <p className="min-h-[4.5em] whitespace-pre-wrap text-base leading-relaxed sm:text-lg">
          {displayed}
          {!done && <span className="animate-pulse">▍</span>}
        </p>
        <div className="mt-2 flex justify-end text-xs text-white/60">
          {done ? '▼ タップで次へ' : '▼ タップでスキップ'}
        </div>
      </div>
    </button>
  );
}
