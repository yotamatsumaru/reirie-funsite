/**
 * 演出オーバーレイ (シェイク / フラッシュ / CG)
 *
 * - シェイクは container を class swap で揺らす想定 → ここではフラッシュと CG のみ
 * - フラッシュ: 一定時間色面オーバーレイ
 * - CG: フルスクリーン画像表示 → クリックで閉じる
 */
'use client';

import { useEffect } from 'react';

export interface FlashOverlayProps {
  flash: { color: string; durationMs: number; nonce: number } | null;
  onDone: () => void;
}

export function FlashOverlay({ flash, onDone }: FlashOverlayProps) {
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(onDone, flash.durationMs);
    return () => clearTimeout(t);
  }, [flash, onDone]);
  if (!flash) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 animate-fade-out"
      style={{ backgroundColor: flash.color, animation: `fade-out ${flash.durationMs}ms ease-out forwards` }}
    />
  );
}

export interface CgOverlayProps {
  cgKey: string | null;
  resolveUrl: (key: string) => string | null;
  onClose: () => void;
}

export function CgOverlay({ cgKey, resolveUrl, onClose }: CgOverlayProps) {
  if (!cgKey) return null;
  const url = resolveUrl(cgKey);
  if (!url) return null;
  return (
    <button
      type="button"
      className="absolute inset-0 z-30 flex items-center justify-center bg-black"
      onClick={onClose}
      aria-label="CG を閉じる"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="h-full w-full object-contain" />
      <span className="absolute bottom-4 right-4 rounded bg-white/20 px-3 py-1 text-xs text-white">
        タップで閉じる
      </span>
    </button>
  );
}
