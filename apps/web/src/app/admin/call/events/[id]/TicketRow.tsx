'use client';

/**
 * TicketRow — 特典会キュー 1 行 (admin)。
 *
 * - 状態に応じて 「NO_SHOW にする (skip)」「WAITING に戻す (restore)」ボタンを出し分け
 * - IN_MAIN_ROOM の行では enteredMainAt からの経過秒タイマーを表示
 *   (perFanSeconds を超えたら赤字に)
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

type TicketStatus = 'WAITING' | 'IN_WAITING_ROOM' | 'IN_MAIN_ROOM' | 'DONE' | 'NO_SHOW';

interface Props {
  eventId: string;
  ticketId: string;
  queuePos: number;
  userLabel: string;
  status: TicketStatus;
  enteredMainAt: string | null; // ISO
  perFanSeconds: number;
}

const STATUS_STYLES: Record<TicketStatus, string> = {
  WAITING: 'bg-slate-100 text-slate-700',
  IN_WAITING_ROOM: 'bg-sky-100 text-sky-700',
  IN_MAIN_ROOM: 'bg-emerald-100 text-emerald-700',
  DONE: 'bg-slate-100 text-slate-500',
  NO_SHOW: 'bg-rose-100 text-rose-700',
};

export function TicketRow({
  eventId,
  ticketId,
  queuePos,
  userLabel,
  status,
  enteredMainAt,
  perFanSeconds,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<'skip' | 'restore' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function callAction(path: 'skip' | 'restore') {
    setError(null);
    setBusy(path);
    try {
      const res = await fetch(`/api/admin/call/events/${eventId}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticketId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? '操作に失敗しました');
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '不明なエラー');
    } finally {
      setBusy(null);
    }
  }

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-2 font-mono text-slate-700">{queuePos}</td>
      <td className="px-4 py-2 text-slate-700">{userLabel}</td>
      <td className="px-4 py-2">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
        >
          {status}
        </span>
      </td>
      <td className="px-4 py-2 text-slate-500">
        {status === 'IN_MAIN_ROOM' && enteredMainAt ? (
          <ElapsedTimer
            startedAt={enteredMainAt}
            limitSeconds={perFanSeconds}
          />
        ) : enteredMainAt ? (
          new Date(enteredMainAt).toLocaleTimeString('ja-JP')
        ) : (
          '—'
        )}
      </td>
      <td className="px-4 py-2 text-right">
        <div className="flex justify-end gap-2">
          {(status === 'WAITING' || status === 'IN_WAITING_ROOM' || status === 'IN_MAIN_ROOM') && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={busy === 'skip'}
              onClick={() => {
                if (confirm(`#${queuePos} ${userLabel} を NO_SHOW にしますか?`)) {
                  void callAction('skip');
                }
              }}
            >
              スキップ
            </Button>
          )}
          {(status === 'NO_SHOW' || status === 'DONE') && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={busy === 'restore'}
              onClick={() => {
                if (confirm(`#${queuePos} ${userLabel} を WAITING に戻しますか?`)) {
                  void callAction('restore');
                }
              }}
            >
              復活
            </Button>
          )}
        </div>
        {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
      </td>
    </tr>
  );
}

function ElapsedTimer({
  startedAt,
  limitSeconds,
}: {
  startedAt: string;
  limitSeconds: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsedSec = Math.floor((now - new Date(startedAt).getTime()) / 1000);
  const safe = Number.isFinite(elapsedSec) && elapsedSec >= 0 ? elapsedSec : 0;
  const over = safe > limitSeconds;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  const txt = `${m}:${String(s).padStart(2, '0')} / ${formatMinSec(limitSeconds)}`;
  return (
    <span
      className={`inline-flex items-center font-mono text-xs ${
        over ? 'font-semibold text-rose-600' : 'text-emerald-700'
      }`}
    >
      {txt}
      {over ? ' ⚠ 超過' : ''}
    </span>
  );
}

function formatMinSec(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
