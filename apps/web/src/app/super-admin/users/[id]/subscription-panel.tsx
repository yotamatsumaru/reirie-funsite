/**
 * サブスク修復 / 手動付与パネル (Client Component) — /super-admin/users/[id]
 *
 *  - 「Stripeと同期」: この顧客の Stripe 上のサブスクを取得し DB を修復する。
 *      Webhook 取りこぼしや後追い決済で INCOMPLETE のまま残った契約を、
 *      1ユーザーだけ素早く ACTIVE に直せる。
 *  - 「手動付与」: Stripe を介さず DB に有料プランを付与する (コンプ/サポート対応)。
 */
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Gift } from 'lucide-react';

type Plan = 'STANDARD' | 'PREMIUM';
type Interval = 'MONTH' | 'YEAR';

const PLAN_LABEL: Record<Plan, string> = { STANDARD: 'スタンダード', PREMIUM: 'プレミアム' };
const INTERVAL_LABEL: Record<Interval, string> = { MONTH: '月額', YEAR: '年額' };

export function SubscriptionPanel({
  userId,
  currentPlan,
  currentStatus,
}: {
  userId: string;
  currentPlan: string | null;
  currentStatus: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<null | 'sync' | 'grant'>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 手動付与フォーム
  const [showGrant, setShowGrant] = useState(false);
  const [plan, setPlan] = useState<Plan>('PREMIUM');
  const [interval, setInterval] = useState<Interval>('YEAR');
  const [months, setMonths] = useState<number>(12);

  const isIncomplete = currentStatus === 'INCOMPLETE' || currentStatus === 'INCOMPLETE_EXPIRED';

  async function call(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/super-admin/users/${userId}/subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
      error?: { message?: string };
    };
    if (!res.ok || !j.ok) {
      setError((j.error?.message as string) ?? `HTTP ${res.status}`);
      return null;
    }
    return j;
  }

  function handleSync() {
    if (
      !window.confirm(
        'このユーザーの Stripe 上のサブスクリプションを取得し、DB を Stripe に合わせて修復します。\n' +
          '（決済が完了していれば ACTIVE に直ります）\n\n実行しますか？',
      )
    ) {
      return;
    }
    setBusy('sync');
    startTransition(async () => {
      const j = await call({ action: 'sync' });
      setBusy(null);
      if (j) {
        const results = (j.results as Array<{ plan: string; status: string }>) ?? [];
        const summary = results.map((r) => `${r.plan}=${r.status}`).join(', ');
        setNotice(
          `Stripe と同期しました（新規 ${j.created ?? 0} / 更新 ${j.updated ?? 0}）${summary ? `: ${summary}` : ''}`,
        );
        router.refresh();
      }
    });
  }

  function handleGrant() {
    if (
      !window.confirm(
        `Stripe を介さず、このユーザーに「${PLAN_LABEL[plan]}（${INTERVAL_LABEL[interval]}・${months}ヶ月）」を手動付与します。\n` +
          '（実際の課金は発生しません。コンプ/サポート対応用です）\n\n実行しますか？',
      )
    ) {
      return;
    }
    setBusy('grant');
    startTransition(async () => {
      const j = await call({ action: 'grant', plan, interval, months });
      setBusy(null);
      if (j) {
        setNotice(`${PLAN_LABEL[plan]} を手動付与しました（${months}ヶ月）。`);
        setShowGrant(false);
        router.refresh();
      }
    });
  }

  const disabled = pending || busy !== null;

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-500">サブスク操作</span>
        <span className="text-[11px] text-slate-400">
          現在: {currentPlan ? `${currentPlan} (${currentStatus})` : 'なし'}
        </span>
      </div>

      {isIncomplete && (
        <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
          このユーザーは「支払い未完了 (INCOMPLETE)」です。Stripe で決済が完了済みの場合は
          「Stripeと同期」で ACTIVE に修復できます。
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSync}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy === 'sync' ? 'animate-spin' : ''}`} />
          {busy === 'sync' ? '同期中…' : 'Stripeと同期'}
        </button>
        <button
          type="button"
          onClick={() => {
            setShowGrant((v) => !v);
            setError(null);
            setNotice(null);
          }}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Gift className="h-3.5 w-3.5" />
          手動付与
        </button>
      </div>

      {showGrant && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-500">
              プラン
              <select
                value={plan}
                onChange={(e) => setPlan(e.target.value as Plan)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800"
              >
                <option value="STANDARD">スタンダード</option>
                <option value="PREMIUM">プレミアム</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-500">
              課金サイクル
              <select
                value={interval}
                onChange={(e) => setInterval(e.target.value as Interval)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800"
              >
                <option value="MONTH">月額</option>
                <option value="YEAR">年額</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-500">
              有効期間(月)
              <input
                type="number"
                min={1}
                max={60}
                value={months}
                onChange={(e) => setMonths(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
                className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800"
              />
            </label>
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowGrant(false)}
              disabled={disabled}
              className="rounded-md px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-100"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={handleGrant}
              disabled={disabled}
              className="rounded-md border border-brand-400 bg-brand-500 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
            >
              {busy === 'grant' ? '付与中…' : 'この内容で付与'}
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-slate-400">
            ※ 実際の課金は発生しません。Stripe 決済を伴う契約は「Stripeと同期」を使ってください。
          </p>
        </div>
      )}

      {notice && (
        <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700">
          {notice}
        </p>
      )}
      {error && (
        <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
