'use client';

/**
 * useWakeLock — 通話中に画面が消灯するのを防ぐ
 *
 * スマホは操作しないと数十秒で画面が消える。通話中は基本的に画面を触らないため、
 * 何もしないと «話している最中に画面が真っ暗になる» ことになる。
 * (画面が消えるとカメラ映像も止まるため、相手からは通話が切れたように見える)
 *
 * Screen Wake Lock API の注意点:
 *   - iOS Safari は 16.4 以降、Firefox は比較的最近の対応。
 *     非対応ブラウザでは «何もしない» で正常終了させる (機能検出)。
 *   - タブが非表示になると **ブラウザが自動で解放する**。
 *     戻ってきたときに再取得しないと、以降ずっと効かない。
 *     → visibilitychange で取り直す。
 *   - 取得は Promise で失敗しうる (省電力モード等)。
 *     通話本体に影響させないため、失敗しても握りつぶす。
 */

import { useEffect, useRef } from 'react';

/** Screen Wake Lock API の最小型 (TS の lib に無い環境でも動くように自前定義) */
type WakeLockSentinelLike = {
  release: () => Promise<void>;
  released?: boolean;
  addEventListener?: (type: 'release', listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
};

/**
 * @param active true の間だけ画面消灯を防ぐ (通話中のみ true にする)
 */
export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (!active) return;
    if (typeof navigator === 'undefined') return;

    const nav = navigator as WakeLockNavigator;
    // 非対応ブラウザ (iOS 16.3 以前など) では何もしない
    if (!nav.wakeLock?.request) return;

    let cancelled = false;

    const acquire = async () => {
      // すでに保持しているなら取り直さない
      if (sentinelRef.current && sentinelRef.current.released === false) return;
      try {
        const sentinel = await nav.wakeLock!.request('screen');
        if (cancelled) {
          // 取得中に通話が終わっていた場合は即解放する
          void sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
      } catch {
        // 省電力モード等では取得できない。通話は続行させる
      }
    };

    void acquire();

    /**
     * タブが非表示になるとブラウザが Wake Lock を解放するため、
     * 戻ってきたら取り直す (これが無いと一度アプリを切り替えただけで効かなくなる)
     */
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      const s = sentinelRef.current;
      sentinelRef.current = null;
      if (s) void s.release().catch(() => {});
    };
  }, [active]);
}
