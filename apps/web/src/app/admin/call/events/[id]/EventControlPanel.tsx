'use client';

/**
 * EventControlPanel — 特典会イベントの司令塔 UI (スタッフ操作)
 *
 * - 「次のファンを呼ぶ」ボタン (POST /api/admin/call/events/[id]/next)
 * - シリアル発行 (POST /api/admin/call/events/[id]/serials)
 * - CSV ダウンロード (GET 同 URL)
 *
 * ※ 最低限の動作のみ。リアルタイム反映は router.refresh() で行う。
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';

type EventStatus = 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELED';

interface Props {
  eventId: string;
  eventStatus: EventStatus;
  unusedSerialCount: number;
  totalSerialCount: number;
}

export function EventControlPanel({
  eventId,
  eventStatus,
  unusedSerialCount,
  totalSerialCount,
}: Props) {
  const router = useRouter();
  const [issuing, setIssuing] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [ending, setEnding] = useState(false);
  const [issueCount, setIssueCount] = useState('10');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isClosed = eventStatus === 'ENDED' || eventStatus === 'CANCELED';

  async function onNext() {
    setError(null);
    setMessage(null);
    setAdvancing(true);
    try {
      const res = await fetch(`/api/admin/call/events/${eventId}/next`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ closeCurrent: true }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? '次のファンの呼び出しに失敗しました');
      }
      const j = await res.json();
      if (!j.next) {
        setMessage('待機中のファンはもう居ません。');
      } else {
        const name =
          j.next.user?.displayName ?? j.next.user?.email ?? `#${j.next.queuePos}`;
        setMessage(`${name} さんを本ルームへ呼び出しました。`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '不明なエラー');
    } finally {
      setAdvancing(false);
    }
  }

  async function onEndEvent() {
    if (!confirm('このイベントを終了 (ENDED) しますか? もう「次のファンを呼ぶ」は使えなくなります。')) {
      return;
    }
    setError(null);
    setMessage(null);
    setEnding(true);
    try {
      const res = await fetch(`/api/admin/call/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'ENDED' }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? 'イベント終了に失敗しました');
      }
      setMessage('イベントを終了しました。');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '不明なエラー');
    } finally {
      setEnding(false);
    }
  }

  async function onIssueSerials() {
    setError(null);
    setMessage(null);
    setIssuing(true);
    try {
      const res = await fetch(`/api/admin/call/events/${eventId}/serials`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ count: Number(issueCount) }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? 'シリアル発行に失敗しました');
      }
      const j = await res.json();
      setMessage(`${j.issued} 件のシリアルを発行しました。`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '不明なエラー');
    } finally {
      setIssuing(false);
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">司令塔操作</h2>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-slate-600">
            「次のファンを呼ぶ」を押すと、現在の本ルームの人を終了 (DONE) し、
            キューの先頭の人を本ルームへ進めます。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={onNext}
              loading={advancing}
              size="lg"
              disabled={isClosed}
            >
              次のファンを呼ぶ →
            </Button>
            <Button
              onClick={onEndEvent}
              loading={ending}
              size="lg"
              variant="danger"
              disabled={isClosed}
            >
              イベントを終了する
            </Button>
          </div>
          {isClosed ? (
            <p className="text-xs text-slate-500">
              ※ このイベントは {eventStatus} のため操作できません。
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">シリアル管理</h2>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-slate-600">
            発行済: {totalSerialCount} / 未使用: {unusedSerialCount}
          </p>
          <div className="flex items-end gap-2">
            <div className="w-32">
              <Input
                label="発行枚数"
                type="number"
                min={1}
                max={2000}
                value={issueCount}
                onChange={(e) => setIssueCount(e.target.value)}
              />
            </div>
            <Button
              onClick={onIssueSerials}
              loading={issuing}
              variant="secondary"
              disabled={isClosed}
            >
              発行する
            </Button>
            <a
              href={`/api/admin/call/events/${eventId}/serials`}
              className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 hover:bg-slate-50"
            >
              CSV DL
            </a>
          </div>
        </CardBody>
      </Card>

      {(message || error) && (
        <div className="md:col-span-2">
          {message ? (
            <p className="text-sm text-emerald-700">{message}</p>
          ) : null}
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        </div>
      )}
    </div>
  );
}
