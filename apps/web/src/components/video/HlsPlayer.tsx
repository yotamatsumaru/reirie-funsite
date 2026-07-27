/**
 * HLS 動画プレイヤー (Client Component)
 *
 * - hls.js を用いて .m3u8 (HLS / TS セグメント) を再生する。
 * - Safari 等ネイティブ HLS 対応ブラウザでは <video> の src で直接再生。
 * - maxHeight を指定するとプラン別の最大画質にレンディションを制限する
 *   (例: 720p → 高さ720以下のレベルのみ許可)。
 */
'use client';

import { useEffect, useRef, useState } from 'react';

export type HlsPlayerProps = {
  src: string;
  /** 許可する最大の縦解像度 (例: 480 / 720 / 1080)。未指定なら制限なし。 */
  maxHeight?: number;
  poster?: string;
  autoPlay?: boolean;
  className?: string;
};

export function HlsPlayer({ src, maxHeight, poster, autoPlay, className }: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let destroyed = false;
    // 動的 import で SSR バンドルから hls.js を除外する
    let cleanup = () => {};

    (async () => {
      // Safari / iOS はネイティブ HLS 対応
      const canNative = video.canPlayType('application/vnd.apple.mpegurl');
      if (canNative) {
        video.src = src;
        return;
      }

      const Hls = (await import('hls.js')).default;
      if (destroyed) return;

      if (!Hls.isSupported()) {
        // 最後の手段としてネイティブに委ねる
        video.src = src;
        return;
      }

      const hls = new Hls({
        // プレイヤーサイズではなく、明示指定した maxHeight で画質を制限する。
        capLevelToPlayerSize: false,
      });

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        if (maxHeight && data.levels?.length) {
          // maxHeight を超えるレンディションを自動画質選択の対象外にする
          // (autoLevelCapping = 許可する最大レベルのインデックス)。
          const allowed = data.levels
            .map((lvl, idx) => ({ idx, height: lvl.height ?? 0 }))
            .filter((l) => l.height === 0 || l.height <= maxHeight)
            .map((l) => l.idx);
          if (allowed.length > 0) {
            hls.autoLevelCapping = Math.max(...allowed);
          }
        }
      });

      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              setError('動画の再生中にエラーが発生しました');
              hls.destroy();
          }
        }
      });

      cleanup = () => hls.destroy();
    })().catch(() => setError('プレイヤーの初期化に失敗しました'));

    return () => {
      destroyed = true;
      cleanup();
    };
  }, [src, maxHeight]);

  return (
    <div className={className}>
      <video
        ref={videoRef}
        controls
        playsInline
        poster={poster}
        autoPlay={autoPlay}
        className="aspect-video w-full bg-black"
      />
      {error && (
        <p className="bg-rose-50 px-3 py-2 text-center text-sm text-rose-600">{error}</p>
      )}
    </div>
  );
}
