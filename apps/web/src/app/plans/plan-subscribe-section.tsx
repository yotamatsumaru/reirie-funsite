'use client';

/**
 * プラン 3 カラム + Stripe Checkout / プラン変更予約 の起動ボタン
 *
 * プラン変更ルール:
 *  - 未契約 (FREE): 各有料プランへ Stripe Checkout で新規加入。
 *  - 契約中 (STANDARD / PREMIUM): 即時のプラン切替は行わない。
 *      他プランのボタンは「契約満了時に切り替える予約」を作成する。
 *      すでに予約済みの場合は「予約を解除」できる。
 *  - 現在契約中のプランのカードは「現在のプラン (管理)」を表示。
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  PLAN_LABELS,
  PLAN_PRICES,
  PLAN_HIGHLIGHTS,
  PLAN_BILLING_INTERVAL,
  RECOMMENDED_PLAN,
  type PlanTypeLiteral,
} from '@idol/shared';

type PaidPlan = 'STANDARD' | 'PREMIUM';

interface ActiveSubscription {
  planType: PaidPlan;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  scheduledPlanType: PaidPlan | null;
}

interface Props {
  currentPlan: PlanTypeLiteral;
  isAuthenticated: boolean;
  subscription: ActiveSubscription | null;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function PlanSubscribeSection({ currentPlan, isAuthenticated, subscription }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submittingPlan, setSubmittingPlan] = useState<PaidPlan | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hasActiveSub = !!subscription;
  const scheduledPlan = subscription?.scheduledPlanType ?? null;
  const periodEnd = subscription?.currentPeriodEnd ?? null;

  // 新規加入 (未契約時のみ)
  const handleSubscribe = (plan: PaidPlan) => {
    setError(null);
    setNotice(null);
    if (!isAuthenticated) {
      router.push(`/signin?next=${encodeURIComponent('/plans')}`);
      return;
    }

    const interval = PLAN_BILLING_INTERVAL[plan] ?? 'MONTH';
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

  // 契約中の別プランへの「満了時切替」予約
  const handleSchedule = (plan: PaidPlan) => {
    setError(null);
    setNotice(null);
    setSubmittingPlan(plan);
    startTransition(async () => {
      try {
        const res = await fetch('/api/subscriptions/change-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(j?.error?.message ?? 'プラン変更の予約に失敗しました');
        }
        setNotice(
          j?.effectiveAt
            ? `${formatDate(j.effectiveAt)}に${PLAN_LABELS[plan]}へ切り替わります。`
            : 'プラン変更を予約しました。',
        );
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : '不明なエラー');
      } finally {
        setSubmittingPlan(null);
      }
    });
  };

  // プラン変更予約の解除
  const handleCancelSchedule = () => {
    setError(null);
    setNotice(null);
    setSubmittingPlan('cancel');
    startTransition(async () => {
      try {
        const res = await fetch('/api/subscriptions/change-plan/cancel', {
          method: 'POST',
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(j?.error?.message ?? '予約の解除に失敗しました');
        }
        setNotice('プラン変更の予約を解除しました。');
        router.refresh();
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
      {error && (
        <div className="mx-auto mb-6 max-w-md rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-center text-sm text-rose-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mx-auto mb-6 max-w-md rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-center text-sm text-emerald-700">
          {notice}
        </div>
      )}

      {/* 予約中バナー */}
      {hasActiveSub && scheduledPlan && periodEnd && (
        <div className="mx-auto mb-6 max-w-2xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-800">
          <p>
            <span className="font-semibold">{formatDate(periodEnd)}</span> に
            <span className="font-semibold">{PLAN_LABELS[scheduledPlan]}</span>
            へ切り替わる予約があります。
          </p>
          <button
            type="button"
            onClick={handleCancelSchedule}
            disabled={pending}
            className="mt-2 rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
          >
            {submittingPlan === 'cancel' ? '解除中…' : '予約を解除する'}
          </button>
        </div>
      )}

      {/* 3 カラム */}
      <div className="grid gap-6 sm:grid-cols-3">
        {(['FREE', 'STANDARD', 'PREMIUM'] as const).map((p) => {
          const isCurrent = currentPlan === p;
          const isRec = p === RECOMMENDED_PLAN;
          const price = PLAN_PRICES[p];
          const planInterval = PLAN_BILLING_INTERVAL[p]; // null=無料 / 'MONTH' / 'YEAR'
          const displayPrice = planInterval === 'YEAR' ? price.yearly : price.monthly;
          const intervalLabel = planInterval === 'YEAR' ? '年' : '月';
          const submitting = pending && submittingPlan === p;
          const isScheduledTarget = scheduledPlan === p;

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
                {p === 'FREE' ? (
                  <span className="text-3xl font-extrabold text-slate-900">無料</span>
                ) : (
                  <>
                    <span className="text-3xl font-extrabold text-slate-900">
                      ¥{displayPrice.toLocaleString()}
                    </span>
                    <span className="text-sm text-slate-500">/ {intervalLabel}</span>
                  </>
                )}
              </div>
              {p !== 'FREE' && (
                <p className="mt-1 text-xs text-slate-500">
                  {planInterval === 'YEAR'
                    ? `月額換算 ¥${Math.floor(price.yearly / 12).toLocaleString()} ・ 税込`
                    : '税込'}
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
              {renderCta({
                plan: p,
                isCurrent,
                isRec,
                isScheduledTarget,
                hasActiveSub,
                periodEnd,
                submitting,
                isAuthenticated,
                onSubscribe: handleSubscribe,
                onSchedule: handleSchedule,
                onManage: handleManage,
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * カード下部の CTA を状況に応じて描画する。
 */
function renderCta(args: {
  plan: PlanTypeLiteral;
  isCurrent: boolean;
  isRec: boolean;
  isScheduledTarget: boolean;
  hasActiveSub: boolean;
  periodEnd: string | null;
  submitting: boolean;
  isAuthenticated: boolean;
  onSubscribe: (p: PaidPlan) => void;
  onSchedule: (p: PaidPlan) => void;
  onManage: () => void;
}) {
  const {
    plan,
    isCurrent,
    isRec,
    isScheduledTarget,
    hasActiveSub,
    periodEnd,
    submitting,
    isAuthenticated,
    onSubscribe,
    onSchedule,
    onManage,
  } = args;

  // FREE カードは常にデフォルト表示 (加入対象外)
  if (plan === 'FREE') {
    return (
      <button
        type="button"
        disabled
        className="w-full cursor-not-allowed rounded-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-400"
      >
        デフォルトプラン
      </button>
    );
  }

  // 現在契約中のプラン
  if (isCurrent) {
    return (
      <button
        type="button"
        onClick={onManage}
        className="w-full rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        現在のプラン (管理)
      </button>
    );
  }

  const paidPlan = plan as PaidPlan;

  // 契約中 → 他プランは「満了時切替の予約」
  if (hasActiveSub) {
    // すでにこのプランへの切替が予約済み
    if (isScheduledTarget) {
      return (
        <button
          type="button"
          disabled
          className="w-full cursor-not-allowed rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700"
        >
          {periodEnd ? `${formatDate(periodEnd)}に切替予約中` : '切替予約中'}
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => onSchedule(paidPlan)}
        disabled={submitting}
        className={`w-full rounded-md px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
          isRec
            ? 'bg-brand-600 text-white hover:bg-brand-700'
            : 'bg-slate-900 text-white hover:bg-slate-800'
        }`}
      >
        {submitting ? '処理中…' : `満了時に${PLAN_LABELS[paidPlan]}へ変更 (予約)`}
      </button>
    );
  }

  // 未契約 (FREE) → 新規加入 (Stripe Checkout)
  return (
    <button
      type="button"
      onClick={() => onSubscribe(paidPlan)}
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
          ? `${PLAN_LABELS[paidPlan]}に加入する`
          : 'ログインして加入する'}
    </button>
  );
}
