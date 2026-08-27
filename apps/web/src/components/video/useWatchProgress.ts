/**
 * 動画の視聴進捗を計測してサーバへ送るフック。
 *
 * ## 計測方法: timeupdate の差分を積む
 *
 * 「再生開始時刻と終了時刻の差」では測れない。一時停止・タブ切り替え・
 * バッファ待ちの時間まで視聴時間に入ってしまい、動画を開いたまま
 * 放置した人が「全部見た」ことになる。
 *
 * かわりに `timeupdate` (再生中に 4 回/秒ほど発火) で
 * **前回の currentTime との差分**を積む。これなら
 *   - 一時停止中は timeupdate が来ないので増えない
 *   - シークで飛んだ分は差分が大きくなるので除外する (下記)
 * となり「実際に再生された時間」に近い値になる。
 *
 * ## シークの扱い
 *
 * 差分が閾値 (SEEK_THRESHOLD_SEC) を超えたらシークとみなして加算しない。
 * 早送りで飛ばした区間を視聴時間に入れると、10 秒で 1 時間の動画を
 * 「全部見た」ことにできてしまう。巻き戻しは差分が負になるので
 * 自然に除外される (見直した分はその後の再生で正しく積まれる)。
 *
 * ## 再生速度の扱い
 *
 * currentTime の差分を使うので、2 倍速で見ると実時間 30 秒で
 * 60 秒分が積まれる。これは意図した挙動で、集計の目的は
 * 「動画のどれだけが消費されたか」であり、視聴者が席に座っていた
 * 実時間ではないため。
 *
 * ## 送信タイミング
 *
 * - 一定間隔 (PROGRESS_INTERVAL_SEC) ごと
 * - 一時停止 / 再生終了時
 * - ページを離れる時 (visibilitychange / pagehide)
 *
 * ページ離脱時は通常の fetch では中断されるため `keepalive` を使う。
 * これを入れないと「最後の 15 秒未満」が常に失われ、
 * 短い動画では計測がまるごと欠ける。
 *
 * ## 失敗時
 *
 * 送信失敗は無視する。計測は付加的な機能で、
 * エラー表示を出すと視聴体験を損なうため。
 */
'use client';

import { useEffect, useRef } from 'react';
import { PROGRESS_INTERVAL_SEC } from '@/lib/video-progress';

/** これを超える currentTime の飛びはシークとみなし、視聴時間に加算しない (秒)。 */
const SEEK_THRESHOLD_SEC = 3;

export function useWatchProgress({
  videoRef,
  videoId,
  viewLogId,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoId: string;
  /** playback API が返した視聴ログ ID。null なら計測しない。 */
  viewLogId: string | null;
}) {
  // ref に持つ理由: これらは再レンダリングを起こす必要がなく、
  // イベントハンドラ内から常に最新値を読みたいため。
  const watchedMsRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  // 最後に送信した値。変化が無いときに送らないための比較用
  // (一時停止のたびに同じ値を送るとリクエストが無駄に増える)。
  const sentMsRef = useRef(-1);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !viewLogId) return;

    let disposed = false;

    const send = (useKeepalive: boolean) => {
      const watched = Math.floor(watchedMsRef.current);
      const position = Math.floor((video.currentTime || 0) * 1000);
      // 前回と同じなら送らない。ただし完視聴の瞬間を取り逃さないよう、
      // 位置が変わっている場合は送る。
      if (watched === sentMsRef.current && watched > 0 && !useKeepalive) return;
      sentMsRef.current = watched;

      const body = JSON.stringify({ viewLogId, watchedMs: watched, positionMs: position });

      // ページ離脱時は通常の fetch が中断されるので keepalive を使う。
      // sendBeacon ではなく keepalive fetch にしたのは、sendBeacon が
      // POST 固定で Content-Type を JSON にできず、また
      // Cookie 送信の挙動がブラウザ差があるため。
      void fetch(`/api/videos/${videoId}/progress`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: useKeepalive,
      }).catch(() => {
        // 計測の失敗は視聴を妨げない。次の間隔で再送される。
      });
    };

    const onTimeUpdate = () => {
      const now = video.currentTime;
      const prev = lastTimeRef.current;
      lastTimeRef.current = now;
      if (prev === null) return;

      const delta = now - prev;
      // 負値 = 巻き戻し、閾値超え = シーク／早送り。どちらも加算しない。
      if (delta > 0 && delta <= SEEK_THRESHOLD_SEC) {
        watchedMsRef.current += delta * 1000;
      }
    };

    // シーク直後は「飛んだ先」を基準にし直す。
    // これをしないと、シーク後の最初の timeupdate で巨大な差分が出る。
    const onSeeked = () => {
      lastTimeRef.current = video.currentTime;
    };

    // 一時停止 / 終了 / 離脱時は即座に送る。
    // 間隔送信だけだと最後の数秒〜十数秒が失われる。
    const onPause = () => send(false);
    const onEnded = () => send(true);

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') send(true);
    };
    const onPageHide = () => send(true);

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);

    const timer = window.setInterval(() => {
      if (disposed) return;
      // 再生中のみ送る。停止中に送り続けても値は変わらず無駄。
      if (!video.paused && !video.ended) send(false);
    }, PROGRESS_INTERVAL_SEC * 1000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      // アンマウント時 (ページ遷移など) にも取り逃さないよう送る。
      send(true);
    };
  }, [videoRef, videoId, viewLogId]);
}
