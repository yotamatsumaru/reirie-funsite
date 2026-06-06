/**
 * 立ち絵 (キャラクタースプライト) レイヤー
 */
'use client';

export interface SpriteProps {
  speaker?: string;
  expression?: string;
  /** speaker + expression → URL を解決 (例: "him__smile") */
  resolveUrl: (speaker: string, expression?: string) => string | null;
  /** デフォルト立ち絵 (キャラ表紙) */
  fallbackUrl?: string | null;
}

export function Sprite({ speaker, expression, resolveUrl, fallbackUrl }: SpriteProps) {
  const url = speaker ? resolveUrl(speaker, expression) ?? fallbackUrl ?? null : fallbackUrl ?? null;
  if (!url) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[28%] flex items-end justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={speaker ?? ''}
        className="max-h-[70vh] max-w-[90vw] object-contain drop-shadow-2xl transition-opacity duration-300"
        key={`${speaker}-${expression}`}
      />
    </div>
  );
}
