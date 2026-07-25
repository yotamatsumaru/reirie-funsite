/**
 * サブスク行の操作 (Client Component)
 *  - 強制解約 (即時)
 *  - 期末解約予約のトグル
 *  - 返金 (課金明細から個別に Stripe 返金)
 */
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/** 返金モーダルで扱う課金明細 */
type RefundPayment = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  createdAt: string;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  stripeInvoiceId: string | null;
  receiptUrl: string | null;
  refundable: boolean;
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: '保留',
  SUCCEEDED: '成功',
  FAILED: '失敗',
  REFUNDED: '返金済み',
};

function yen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SubRowActions({
  subId,
  status,
  cancelAtPeriodEnd,
  readOnly = false,
}: {
  subId: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  /** スタッフ管理者など閲覧のみの場合 true。書き込み操作ボタンを非表示にする */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 返金モーダル用の状態
  const [refundOpen, setRefundOpen] = useState(false);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [payments, setPayments] = useState<RefundPayment[] | null>(null);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isCanceled = status === 'CANCELED';

  // 閲覧のみ (スタッフ管理者): 書き込み操作は不可
  if (readOnly) {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="text-[11px] text-slate-400">閲覧のみ</span>
      </div>
    );
  }

  async function callApi(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/super-admin/subscriptions/${subId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setError(j.error?.message ?? `HTTP ${res.status}`);
      return false;
    }
    return true;
  }

  function handleCancelImmediate() {
    if (!confirm('この契約を即時解約しますか？(返金は別途「返金」から処理してください)')) return;
    startTransition(async () => {
      const ok = await callApi({ action: 'cancel_immediate' });
      if (ok) router.refresh();
    });
  }

  function handleCancelAtPeriodEnd() {
    const next = !cancelAtPeriodEnd;
    const msg = next ? '期末で解約を予約しますか？' : '期末解約の予約を取り消しますか？';
    if (!confirm(msg)) return;
    startTransition(async () => {
      const ok = await callApi({ action: 'cancel_at_period_end', value: next });
      if (ok) router.refresh();
    });
  }

  async function openRefund() {
    setRefundOpen(true);
    setRefundError(null);
    setNotice(null);
    setLoadingPayments(true);
    setPayments(null);
    try {
      const res = await fetch(`/api/super-admin/subscriptions/${subId}/refund`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setRefundError(j.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as { payments: RefundPayment[] };
      setPayments(j.payments);
    } catch {
      setRefundError('課金明細の取得に失敗しました');
    } finally {
      setLoadingPayments(false);
    }
  }

  async function handleRefund(payment: RefundPayment) {
    setRefundError(null);
    setNotice(null);

    // 一部返金にも対応: 金額を入力させる (空 or 全額なら全額返金)
    const input = window.prompt(
      `返金額を入力してください（円）。\n空欄のまま OK で全額 ${yen(payment.amount)} を返金します。\n一部返金する場合は ${payment.amount} 以下の金額を入力してください。`,
      String(payment.amount),
    );
    // キャンセル
    if (input === null) return;

    let amount: number | undefined;
    const trimmed = input.trim();
    if (trimmed !== '') {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n <= 0 || n > payment.amount) {
        setRefundError(`返金額が不正です（1〜${payment.amount} の整数で入力してください）`);
        return;
      }
      amount = n === payment.amount ? undefined : n;
    }

    const confirmMsg =
      amount == null
        ? `${formatDateTime(payment.createdAt)} の課金 ${yen(payment.amount)} を全額返金します。よろしいですか？\n（Stripe 上で実際に返金が実行されます）`
        : `${formatDateTime(payment.createdAt)} の課金のうち ${yen(amount)} を返金します。よろしいですか？\n（Stripe 上で実際に返金が実行されます）`;
    if (!confirm(confirmMsg)) return;

    setRefundingId(payment.id);
    try {
      const res = await fetch(`/api/super-admin/subscriptions/${subId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(amount == null ? { paymentId: payment.id } : { paymentId: payment.id, amount }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: { message?: string };
        alreadyRefunded?: boolean;
        refundAmount?: number;
        isFullRefund?: boolean;
      };
      if (!res.ok || !j.ok) {
        setRefundError(j.error?.message ?? `返金に失敗しました (HTTP ${res.status})`);
        return;
      }
      if (j.alreadyRefunded) {
        setNotice('この課金はすでに返金済みでした。');
      } else if (j.isFullRefund) {
        setNotice(`全額返金しました（${yen(j.refundAmount ?? payment.amount)}）。`);
      } else {
        setNotice(`一部返金しました（${yen(j.refundAmount ?? amount ?? 0)}）。`);
      }
      // 明細を再取得して状態を反映
      await openRefundReload();
      router.refresh();
    } catch {
      setRefundError('返金処理中にエラーが発生しました');
    } finally {
      setRefundingId(null);
    }
  }

  // 返金後に明細だけ静かに再取得する (モーダルは開いたまま)
  async function openRefundReload() {
    try {
      const res = await fetch(`/api/super-admin/subscriptions/${subId}/refund`);
      if (res.ok) {
        const j = (await res.json()) as { payments: RefundPayment[] };
        setPayments(j.payments);
      }
    } catch {
      /* noop */
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-2">
        {!isCanceled && (
          <>
            <button
              type="button"
              onClick={handleCancelAtPeriodEnd}
              disabled={pending}
              className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
            >
              {cancelAtPeriodEnd ? '予約解除' : '期末解約'}
            </button>
            <button
              type="button"
              onClick={handleCancelImmediate}
              disabled={pending}
              className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
            >
              即時解約
            </button>
          </>
        )}
        {/* 返金はキャンセル済みでも過去の課金に対して行えるよう常に表示する */}
        <button
          type="button"
          onClick={openRefund}
          className="rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100"
        >
          返金
        </button>
      </div>
      {error && <span className="text-xs text-rose-600">{error}</span>}
      {isCanceled && (
        <span className="text-[11px] text-slate-400">解約済み（返金は可能）</span>
      )}

      {refundOpen && (
        <RefundModal
          onClose={() => setRefundOpen(false)}
          loading={loadingPayments}
          payments={payments}
          error={refundError}
          notice={notice}
          refundingId={refundingId}
          onRefund={handleRefund}
        />
      )}
    </div>
  );
}

function RefundModal({
  onClose,
  loading,
  payments,
  error,
  notice,
  refundingId,
  onRefund,
}: {
  onClose: () => void;
  loading: boolean;
  payments: RefundPayment[] | null;
  error: string | null;
  notice: string | null;
  refundingId: string | null;
  onRefund: (p: RefundPayment) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">課金の返金</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            閉じる ✕
          </button>
        </div>

        <p className="mb-3 text-xs text-slate-500">
          この契約に紐づく課金の一覧です。返金する課金の「返金する」を押すと、Stripe 上で実際に返金が実行されます。
          金額を入力すれば一部返金も可能です。
        </p>

        {notice && (
          <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
            {notice}
          </div>
        )}
        {error && (
          <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            {error}
          </div>
        )}

        {loading && <p className="py-6 text-center text-sm text-slate-500">読み込み中…</p>}

        {!loading && payments && payments.length === 0 && (
          <div className="py-6 text-center text-sm text-slate-500">
            <p>この契約に紐づく課金が見つかりませんでした。</p>
            <p className="mt-1 text-xs text-slate-400">
              まだ請求が発生していないか、決済情報が同期されていない可能性があります。
              時間をおいて再度お試しいただくか、Stripe 管理画面をご確認ください。
            </p>
          </div>
        )}

        {!loading && payments && payments.length > 0 && (
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-3 py-2">課金日時</th>
                <th className="px-3 py-2">金額</th>
                <th className="px-3 py-2">状態</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((p) => {
                const isRefunded = p.status === 'REFUNDED';
                return (
                  <tr key={p.id} className={isRefunded ? 'bg-slate-50 text-slate-400' : ''}>
                    <td className="px-3 py-2 text-xs">{formatDateTime(p.createdAt)}</td>
                    <td className="px-3 py-2 font-semibold">{yen(p.amount)}</td>
                    <td className="px-3 py-2 text-xs">
                      <span
                        className={
                          isRefunded
                            ? 'rounded bg-slate-200 px-1.5 py-0.5 font-semibold text-slate-600'
                            : p.status === 'SUCCEEDED'
                              ? 'rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-700'
                              : 'rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600'
                        }
                      >
                        {PAYMENT_STATUS_LABELS[p.status] ?? p.status}
                      </span>
                      {p.receiptUrl && (
                        <a
                          href={p.receiptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 text-[11px] text-sky-600 hover:underline"
                        >
                          レシート
                        </a>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isRefunded ? (
                        <span className="text-xs text-slate-400">返金済み</span>
                      ) : p.refundable ? (
                        <button
                          type="button"
                          onClick={() => onRefund(p)}
                          disabled={refundingId === p.id}
                          className="rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50"
                        >
                          {refundingId === p.id ? '処理中…' : '返金する'}
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400" title="成功済み・Stripe参照がある課金のみ返金できます">
                          返金不可
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
