/**
 * HLS 動画プレイヤー (Client Component)
 *
 * - hls.js を用いて .m3u8 (HLS / TS セグメント) を再生する。
 * - Safari 等ネイティブ HLS 対応ブラウザでは <video> の src で直接再生。
 * - maxHeight を指定するとプラン別の最大画質にレンディションを制限する
 *   (例: 720p → 高さ720以下のレベルのみ許可)。
 *
 * ## 署名クエリの引き継ぎ (`.ts` セグメント 403 対策)
 *
 * CloudFront の署名付き URL は「その URL 1 本」にしか効かないため、
 * プレイリスト内の相対 URI (variant playlist / セグメント) は
 * 署名なしでリクエストされ 403 になる。
 *
 * 本番の再生経路では `/api/videos/<id>/hls/index.m3u8`
 * (プレイリストプロキシ) がサーバ側で URI を書き換えるので、
 * これだけで解決する。
 *
 * ただし CloudFront の署名付き URL を直接 `src` に渡された場合の
 * 保険として、hls.js の `xhrSetup` で「src と同じオリジンかつ
 * クエリ未付与のリクエスト」に src のクエリを引き継ぐ。
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import {
  extractSignatureQuery,
  looksLikeCloudFrontSignature,
  inheritQuery,
} from '@/lib/hls-rewrite';
import { useWatchProgress } from './useWatchProgress';

export type HlsPlayerProps = {
  src: string;
  /** 許可する最大の縦解像度 (例: 480 / 720 / 1080)。未指定なら制限なし。 */
  maxHeight?: number;
  poster?: string;
  autoPlay?: boolean;
  className?: string;
  /**
   * 視聴計測に使う情報。省略すると計測しない（管理画面のプレビュー等）。
   *
   * 運営のプレビュー再生を計測対象にすると、会員の視聴データに
   * 運営の確認作業が混ざって集計が歪むため、明示的に渡す設計にしている。
   */
  progress?: { videoId: string; viewLogId: string | null };
  /**
   * 再生開始位置（秒）。前回の続きから再生する用途。
   * メタデータ読込後に一度だけ適用する。
   */
  startAtSec?: number;
};

export function HlsPlayer({
  src,
  maxHeight,
  poster,
  autoPlay,
  className,
  progress,
  startAtSec,
}: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  // 視聴計測。progress が無ければ内部で何もしない。
  useWatchProgress({
    videoRef,
    videoId: progress?.videoId ?? '',
    viewLogId: progress?.videoId ? (progress.viewLogId ?? null) : null,
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    let destroyed = false;
    // 動的 import で SSR バンドルから hls.js を除外する
    let cleanup = () => {};

    const rawQuery = extractSignatureQuery(src);
    const inherited = looksLikeCloudFrontSignature(rawQuery) ? rawQuery : '';
    const base =
      typeof window !== 'undefined' ? new URL(src, window.location.href).toString() : src;

    (async () => {
      // Safari / iOS はネイティブ HLS 対応。
      // ネイティブ再生では JS からセグメント要求に介入できないため、
      // サーバ側でプレイリストを書き換える必要がある
      // (= /api/videos/<id>/hls/... 経由で再生する)。
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
        // 署名クエリを同一オリジンの後続リクエスト (variant playlist / .ts) に引き継ぐ。
        // 通常はサーバ側プロキシが書き換え済みなので no-op。
        xhrSetup: inherited
          ? (xhr: XMLHttpRequest, url: string) => {
              const next = inheritQuery(url, base, inherited);
              if (next !== url) {
                xhr.open('GET', next, true);
              }
            }
          : undefined,
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
              // 403 (署名切れ / 署名なし) は startLoad しても回復しないため明示する
              if (data.response?.code === 403) {
                setError('動画の視聴期限が切れました。ページを再読み込みしてください');
                hls.destroy();
                break;
              }
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

  // 前回の続きから再生する。
  //
  // 別の useEffect に分けているのは、上の effect は src / maxHeight の変化で
  // プレイヤーを作り直すため、そこに再開位置を混ぜると
  // 画質変更のたびに再生位置が巻き戻る挙動になるため。
  //
  // `loadedmetadata` を待つ理由: 尺が確定する前に currentTime を代入しても
  // 無視される（duration が NaN の間はシークできない）。
  const seekedOnceRef = useRef(false);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !startAtSec || startAtSec <= 0) return;
    seekedOnceRef.current = false;

    const apply = () => {
      // 一度だけ適用する。以後のシークは視聴者の操作を尊重する。
      if (seekedOnceRef.current) return;
      // 尺を超える位置は無視する（尺が縮む再エンコード後などに備える）。
      if (Number.isFinite(video.duration) && startAtSec >= video.duration) return;
      seekedOnceRef.current = true;
      video.currentTime = startAtSec;
    };

    if (video.readyState >= 1) apply();
    video.addEventListener('loadedmetadata', apply);
    return () => video.removeEventListener('loadedmetadata', apply);
  }, [src, startAtSec]);

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
