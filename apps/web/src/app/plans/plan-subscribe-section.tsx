'use client';

/**
 * プラン 3 カラム + 月額/年額切替 + Stripe Checkout 起動ボタン
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  PLAN_LABELS,
  PLAN_PRICES,
  PLAN_HIGHLIGHTS,
  RECOMMENDED_PLAN,
  type PlanTypeLiteral,
} from '@idol/shared';

type Interval = 'MONTH' | 'YEAR';
type PaidPlan = 'STANDARD' | 'PREMIUM';

interface Props {
  currentPlan: PlanTypeLiteral;
  isAuthenticated: boolean;
}

export function PlanSubscribeSection({ currentPlan, isAuthenticated }: Props) {
  const router = useRouter();
  const [interval, setInterval] = useState<Interval>('MONTH');
  const [pending, startTransition] = useTransition();
  const [submittingPlan, setSubmittingPlan] = useState<PaidPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubscribe = (plan: PaidPlan) => {
    setError(null);
    if (!isAuthenticated) {
      router.push(`/signin?next=${encodeURIComponent('/plans')}`);
      return;
    }

    setSubmittingPlan(plan);
    startTransition(async () => {
      try {
        const baseUrl = window.location.origin;
        const res = await fetch('/api/subscriptions/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan,
            interval,
            successUrl: `${baseUrl}/me?subscribed=1`,
            cancelUrl: `${baseUrl}/plans?canceled=1`,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error?.message ?? '決済セッションの作成に失敗しました');
        }
        const data = (await res.json()) as { url?: string };
        if (data.url) window.location.href = data.url;
        else throw new Error('Stripe URL が返ってきませんでした');
      } catch (e) {
        setError(e instanceof Error ? e.message : '不明なエラー');
      } finally {
        setSubmittingPlan(null);
      }
    });
  };

  const handleManage = () => {
    router.push('/me');
  };

  return (
    <section>
      {/* 月額/年額 切替 */}
      <div className="mb-8 flex items-center justify-center">
        <div className="inline-flex rounded-full border border-slate-300 bg-white p-1">
          <button
            type="button"
            onClick={() => setInterval('MONTH')}
            className={`rounded-full px-5 py-2 text-sm font-semibold transition ${
              interval === 'MONTH' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            月額
          </button>
          <button
            type="button"
            onClick={() => setInterval('YEAR')}
            className={`rounded-full px-5 py-2 text-sm font-semibold transition ${
              interval === 'YEAR' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            年額
            <span className="ml-1 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
              2ヶ月分お得
            </span>
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-auto mb-6 max-w-md rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-center text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* 3 カラム */}
      <div className="grid gap-6 sm:grid-cols-3">
        {(['FREE', 'STANDARD', 'PREMIUM'] as const).map((p) => {
          const isCurrent = currentPlan === p;
          const isRec = p === RECOMMENDED_PLAN;
          const price = PLAN_PRICES[p];
          const displayPrice = interval === 'YEAR' ? price.yearly : price.monthly;
          const submitting = pending && submittingPlan === p;

          return (
            <div
              key={p}
              className={`relative flex flex-col rounded-2xl border p-6 ${
                isRec
                  ? 'border-brand-500 bg-gradient-to-b from-brand-50 to-white shadow-lg'
                  : 'border-slate-200 bg-white'
              }`}
            >
              {isRec && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-0.5 text-xs font-bold text-white">
                  おすすめ
                </div>
              )}

              <h3 className="text-lg font-bold text-slate-900">{PLAN_LABELS[p]}</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-extrabold text-slate-900">
                  ¥{displayPrice.toLocaleString()}
                </span>
                <span className="text-sm text-slate-500">/ {interval === 'YEAR' ? '年' : '月'}</span>
              </div>
              {interval === 'YEAR' && p !== 'FREE' && (
                <p className="mt-1 text-xs text-slate-500">
                  月額換算: ¥{Math.floor(price.yearly / 12).toLocaleString()}
                </p>
              )}

              <ul className="my-6 flex-1 space-y-2 text-sm text-slate-700">
                {PLAN_HIGHLIGHTS[p].map((h, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <svg
                      viewBox="0 0 24 24"
                      className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-600"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <path d="M4 12l5 5L20 7" />
                    </svg>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              {p === 'FREE' ? (
                <button
                  type="button"
                  disabled
                  className="w-full cursor-not-allowed rounded-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-400"
                >
                  デフォルトプラン
                </button>
              ) : isCurrent ? (
                <button
                  type="button"
                  onClick={handleManage}
                  className="w-full rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  現在のプラン (管理)
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSubscribe(p as PaidPlan)}
                  disabled={submitting}
                  className={`w-full rounded-md px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
                    isRec
                      ? 'bg-brand-600 text-white hover:bg-brand-700'
                      : 'bg-slate-900 text-white hover:bg-slate-800'
                  }`}
                >
                  {submitting
                    ? '処理中…'
                    : isAuthenticated
                      ? `${PLAN_LABELS[p]}に加入する`
                      : 'ログインして加入する'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
