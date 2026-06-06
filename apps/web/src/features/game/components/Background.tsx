/**
 * 背景画像レイヤー
 */
'use client';

import { useEffect, useState } from 'react';

export interface BackgroundProps {
  /** GameAsset.key (BACKGROUND kind) */
  bgKey?: string;
  /** key → URL の解決マップ (page 側で構築) */
  resolveUrl: (key: string) => string | null;
  /** フェード演出 */
  fade?: boolean;
}

export function Background({ bgKey, resolveUrl, fade = true }: BackgroundProps) {
  const [current, setCurrent] = useState<string | null>(null);
  const [prev, setPrev] = useState<string | null>(null);

  useEffect(() => {
    const url = bgKey ? resolveUrl(bgKey) : null;
    if (url === current) return;
    setPrev(current);
    setCurrent(url);
    if (fade && current) {
      const t = setTimeout(() => setPrev(null), 450);
      return () => clearTimeout(t);
    }
    setPrev(null);
    return undefined;
  }, [bgKey, current, fade, resolveUrl]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-slate-900" aria-hidden>
      {prev && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={prev}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-100 transition-opacity duration-500"
        />
      )}
      {current && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={current}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-100 transition-opacity duration-500"
        />
      )}
      {!current && (
        <div className="absolute inset-0 bg-gradient-to-b from-slate-700 via-slate-800 to-slate-900" />
      )}
    </div>
  );
}
