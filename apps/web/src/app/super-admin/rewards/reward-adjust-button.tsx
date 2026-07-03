'use client';

/**
 * 特典ポイント手動調整ボタン (SUPER_ADMIN 用)。
 * クリックでインライン入力を開き、増減ポイントと理由を入力して調整。
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RewardPointAdjustButton({
  userId,
  currentBalance,
}: {
  userId: string;
  currentBalance: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitAdjust() {
    setError(null);
    const value = Number(amount);
    if (!Number.isInteger(value) || value === 0) {
      setError('0 以外の整数を入力してください');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/super-admin/reward-points/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, amount: value, note: note || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? '調整に失敗しました');
        return;
      }
      setOpen(false);
      setAmount('');
      setNote('');
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
        調整
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5 text-left">
      <p className="text-[11px] text-slate-500">現在 {currentBalance.toLocaleString()}pt</p>
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="±pt (例: 100, -50)"
        className="w-36 rounded border border-slate-300 px-2 py-1 text-xs"
      />
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="理由 (任意)"
        maxLength={200}
        className="w-36 rounded border border-slate-300 px-2 py-1 text-xs"
      />
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={submitAdjust}
          disabled={busy}
          className="rounded bg-slate-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? '処理中…' : '確定'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          取消
        </button>
      </div>
    </div>
  );
}
