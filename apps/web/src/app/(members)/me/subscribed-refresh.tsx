'use client';

/**
 * Stripe Checkout から戻ってきた直後 (?subscribed=1) に、ログインセッション (JWT) の
 * プラン情報を強制リフレッシュするためのクライアントコンポーネント。
 *
 * ## 背景
 * auth.ts の jwt callback は plan を最大5分キャッシュする。加入直後に戻ってくると、
 * DB には ACTIVE なサブスクがあるのに JWT はまだ FREE のまま、という反映ラグが起きる。
 * `useSession().update()` を呼ぶと jwt callback が `trigger === 'update'` で走り、
 * DB から最新プランを読み直すため、サイドバーやアクセス制御など「JWT を見ている箇所」も
 * 即座に新しいプランへ更新される。
 *
 * ## 挙動
 * - `?subscribed=1` のときだけ 1 回だけ update() を実行する。
 * - Webhook がわずかに遅延して DB 反映前だった場合に備え、短い間隔で数回リトライする。
 * - サイドバーのプラン表示 (member-summary-store, /api/me/summary 由来) も併せて
 *   再取得し、会員カード・マイページ・サイドバーのプラン表示を揃える。
 */
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useMemberSummaryStore } from '@/stores/member-summary-store';

export function SubscribedRefresh() {
  const params = useSearchParams();
  const { update } = useSession();
  const done = useRef(false);

  const subscribed = params.get('subscribed') === '1';

  useEffect(() => {
    if (!subscribed || done.current) return;
    done.current = true;

    let cancelled = false;
    // Webhook 反映のわずかな遅延に備え、0s / 2s / 5s の3回リフレッシュを試みる。
    const delays = [0, 2000, 5000];
    const timers = delays.map((d) =>
      setTimeout(() => {
        if (cancelled) return;
        // JWT (アクセス制御・session.user.plan 参照箇所) を最新化
        void update();
        // サイドバーのプラン表示 (DB 直読みの /api/me/summary) も再取得
        void useMemberSummaryStore.getState().fetchSummary();
      }, d),
    );
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [subscribed, update]);

  return null;
}
