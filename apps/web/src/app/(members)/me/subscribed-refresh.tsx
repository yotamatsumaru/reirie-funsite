'use client';

/**
 * Stripe Checkout から戻ってきた直後 (?subscribed=1) に、
 *   1) 自己回復のための Stripe 同期 (sync-me) を呼び、
 *   2) ログインセッション (JWT) のプラン情報を強制リフレッシュする
 * クライアントコンポーネント。
 *
 * ## 背景 (根本対策: Webhook 取りこぼしの自己回復)
 * 従来は auth.ts の jwt callback が plan を最大5分キャッシュしていることによる
 * 「反映ラグ」だけを想定し、update() のリトライだけを行っていた。
 * しかし実際には Webhook (`customer.subscription.*`) 自体が取りこぼされ、
 * DB に Subscription 行が作られないまま FREE 扱いが固定化するケースがあり、
 * この場合は何度 update() をリトライしても直らない
 * (「支払ったのにスタンダードプランへ更新できていない」という問い合わせの実例あり)。
 *
 * そこで Checkout 成功直後は、まず `/api/subscriptions/sync-me` を呼んで
 * Stripe の実データをその場で DB に取り込み (Webhook を待たない自己修復)、
 * その後に JWT / サイドバー表示を更新する。
 *
 * ## 挙動
 * - `?subscribed=1` のときだけ 1 回だけ実行する。
 * - まず sync-me を await し (失敗しても握りつぶして続行)、
 *   その後 0s / 2s / 5s の3回、JWT とサイドバー表示をリフレッシュする
 *   (sync-me 自体が非同期にコミットされる可能性やネットワーク遅延に備えた保険)。
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

    async function run() {
      // 1) Webhook を待たず、その場で Stripe の実データを DB に同期する。
      //    失敗してもここで止めず、以降の JWT リフレッシュ (2) は必ず行う
      //    (Webhook が正常に届いていれば、こちらのリトライだけで反映される)。
      try {
        await fetch('/api/subscriptions/sync-me', { method: 'POST' });
      } catch {
        // ネットワークエラー等は無視 (下の update() リトライに委ねる)
      }
      if (cancelled) return;

      // 2) JWT (アクセス制御・session.user.plan 参照箇所) とサイドバー表示を更新。
      //    sync-me の DB 書き込みタイミングや、素の Webhook 反映の遅延に備え、
      //    0s / 2s / 5s の3回リフレッシュを試みる。
      const delays = [0, 2000, 5000];
      for (const d of delays) {
        await new Promise((resolve) => setTimeout(resolve, d));
        if (cancelled) return;
        void update();
        void useMemberSummaryStore.getState().fetchSummary();
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [subscribed, update]);

  return null;
}
