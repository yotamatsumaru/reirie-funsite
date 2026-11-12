'use client';

/**
 * Mero の付与 / 減算ボタン (SUPER_ADMIN 用)。
 * Pui の PointAdjustButton と同じ操作感にそろえ、理由 (ライブ特典 / 物販特典 等) を必須で選ばせる。
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MAX_MERO_PER_TX,
  MERO_MANUAL_REASONS,
  MERO_REASON_LABELS,
  type MeroManualReasonLiteral,
} from '@idol/shared';

export function MeroAdjustButton({
  userId,
  label,
  currentBalance,
}: {
  userId: string;
  label: string;
  currentBalance: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<MeroManualReasonLiteral>('LIVE_BENEFIT');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setOpen(false);
    setAmount('');
    setNote('');
    setReason('LIVE_BENEFIT');
    setError(null);
  }

  async function submit() {
    setError(null);
    const value = Number(amount);
    if (!Number.isInteger(value) || value === 0) {
      setError('0 以外の整数を入力してください');
      return;
    }
    if (Math.abs(value) > MAX_MERO_PER_TX) {
      setError(`1 回で動かせるのは ±${MAX_MERO_PER_TX.toLocaleString()} までです`);
      return;
    }
    if (value < 0 && currentBalance + value < 0) {
      setError(`残高 (${currentBalance.toLocaleString()}) を超えて減らせません`);
      return;
    }
    const verb = value > 0 ? `${value.toLocaleString()} Mero 付与` : `${(-value).toLocaleString()} Mero 減算`;
    if (!confirm(`${label} に ${verb}します（${MERO_REASON_LABELS[reason]}）。よろしいですか？`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/super-admin/mero/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, amount: value, reason, note: note.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error?.message ?? '処理に失敗しました');
        return;
      }
      reset();
      router.refresh();
    } catch {
      setError('通信エラーが発生しました');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        付与 / 調整
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5 text-left">
      <p className="text-[11px] text-slate-500">現在 {currentBalance.toLocaleString()} Mero</p>
      <select
        value={reason}
        onChange={(e) => setReason(e.target.value as MeroManualReasonLiteral)}
        aria-label="理由"
        className="w-44 rounded border border-slate-300 px-2 py-1 text-xs"
      >
        {MERO_MANUAL_REASONS.map((r) => (
          <option key={r} value={r}>
            {MERO_REASON_LABELS[r]}
          </option>
        ))}
      </select>
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="±Mero (例: 10, -5)"
        aria-label="増減する Mero"
        className="w-44 rounded border border-slate-300 px-2 py-1 text-xs"
      />
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="メモ (ライブ名・注文番号など)"
        aria-label="メモ"
        maxLength={200}
        className="w-44 rounded border border-slate-300 px-2 py-1 text-xs"
      />
      {error && <p className="max-w-44 text-[11px] text-rose-600">{error}</p>}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? '処理中…' : '確定'}
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          取消
        </button>
      </div>
    </div>
  );
}
