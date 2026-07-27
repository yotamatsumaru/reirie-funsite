/**
 * 動画視聴クライアント。
 *   - マウント時に /api/videos/[id]/playback で CloudFront 署名付き HLS URL を取得
 *   - HlsPlayer で再生 (プラン別最大画質に制限)
 *   - 署名URLの有効期限が切れたら再取得できるようにする
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { HlsPlayer } from '@/components/video/HlsPlayer';

export function VideoWatch({
  videoId,
  maxHeight,
  thumbnailUrl,
}: {
  videoId: string;
  maxHeight: number;
  thumbnailUrl?: string | null;
}) {
  const [hlsUrl, setHlsUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${videoId}/playback`, { method: 'POST' });
      const j = (await res.json().catch(() => ({}))) as {
        hlsUrl?: string;
        error?: { message?: string };
      };
      if (!res.ok || !j.hlsUrl) {
        throw new Error(j.error?.message ?? '動画を再生できませんでした');
      }
      setHlsUrl(j.hlsUrl);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-xl bg-slate-900">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      </div>
    );
  }

  if (error || !hlsUrl) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-xl bg-slate-900 text-white">
        <p className="text-sm">{error ?? '動画を再生できませんでした'}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold hover:bg-brand-600"
        >
          再試行
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl bg-black">
      <HlsPlayer src={hlsUrl} maxHeight={maxHeight} poster={thumbnailUrl ?? undefined} autoPlay />
    </div>
  );
}
