'use client';

/**
 * MaintenanceWatcher — /maintenance ページ用のクライアント監視コンポーネント
 *
 * 一定間隔で /api/maintenance-status をポーリングし、メンテナンスが解除
 * (enabled=false) されたことを検知したら自動的にトップページへ遷移する。
 * これにより、メンテナンス終了後にこのページを開いたまま待っているユーザーが
 * 手動リロードしなくてもサイトへ戻れる。
 *
 * - タブが非表示のときはポーリングしない (復帰時に即チェック)。
 * - 遷移はハードナビゲーション (location.assign) で行い、キャッシュされた
 *   メンテナンス表示が残らないようにする。
 */
import { useEffect, useRef, useState } from 'react';

/** ポーリング間隔 (ms) */
const POLL_INTERVAL_MS = 15_000;

export function MaintenanceWatcher() {
  const [recovering, setRecovering] = useState(false);
  const redirectedRef = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let aborted = false;

    async function check() {
      if (redirectedRef.current) return;
      try {
        const res = await fetch('/api/maintenance-status', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { enabled?: boolean };
        if (!aborted && data && data.enabled === false) {
          redirectedRef.current = true;
          setRecovering(true);
          // ハードナビゲーションでトップへ (メンテ表示のキャッシュを確実に破棄)
          window.location.assign('/');
        }
      } catch {
        // ネットワーク一時エラーは無視し、次回ポーリングで再試行する
      }
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') void check();
    }

    // 初回は少し待ってからチェック (解除直後の即遷移を狙う)
    const initial = setTimeout(() => void check(), 3_000);
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') void check();
    }, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      aborted = true;
      clearTimeout(initial);
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  if (!recovering) return null;

  return (
    <p className="mt-4 text-xs font-medium text-brand-600" role="status" aria-live="polite">
      メンテナンスが終了しました。トップページへ移動しています…
    </p>
  );
}
