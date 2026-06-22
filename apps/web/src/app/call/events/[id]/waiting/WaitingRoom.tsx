'use client';

/**
 * ファン待機室 client component。
 *
 * - SSE `/api/call/events/[id]/queue/events` を購読してリアルタイムに状況を表示
 * - 注意事項を画面上部に常時表示
 * - 自分の status:
 *     WAITING / IN_WAITING_ROOM => 「現在 N 番目」表示
 *     IN_MAIN_ROOM              => 「本ルームへ移動」ボタンを表示
 *     DONE                      => 「終了しました」表示
 *     NO_SHOW                   => 「スキップされました」表示
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CallQueueSnapshot } from '@idol/shared';
import { Button } from '@/components/ui/Button';

interface Props {
  eventId: string;
  ticketId: string;
  queuePos: number;
  noticeText: string | null | undefined;
}

export function WaitingRoom({ eventId, ticketId, queuePos, noticeText }: Props) {
  const router = useRouter();
  const [snap, setSnap] = useState<CallQueueSnapshot | null>(null);
  const [connStatus, setConnStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');

  useEffect(() => {
    const url = `/api/call/events/${eventId}/queue/events`;
    const es = new EventSource(url);

    es.addEventListener('open', () => setConnStatus('open'));
    es.addEventListener('snapshot', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as CallQueueSnapshot;
        setSnap(data);
      } catch (err) {
        console.error('[waiting-room] snapshot parse error', err);
      }
    });
    es.addEventListener('error', () => {
      setConnStatus('closed');
      // EventSource は自動再接続するので close は呼ばない
    });

    return () => {
      es.close();
    };
  }, [eventId]);

  const meStatus = snap?.me?.status ?? 'WAITING';
  const ahead = snap?.me?.aheadCount ?? null;

  return (
    <div className="space-y-6">
      {/* 注意事項 */}
      {noticeText ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-base font-semibold text-amber-900">注意事項</h2>
          <pre className="mt-2 whitespace-pre-wrap text-sm text-amber-900">{noticeText}</pre>
        </section>
      ) : null}

      {/* 状態カード */}
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">あなたの整理番号</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">#{queuePos}</p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              connStatus === 'open'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {connStatus === 'open' ? '接続中' : '接続待機'}
          </span>
        </div>

        <div className="mt-6 border-t border-slate-100 pt-6">
          {renderStatus({
            ticketId,
            meStatus,
            ahead,
            current: snap?.current ?? null,
            onJoin: () => router.push(`/call/events/${eventId}/main`),
          })}
        </div>
      </section>

      <p className="text-center text-xs text-slate-500">
        ※ ブラウザを閉じたり画面をスリープさせると順番が回ってきても気づけません。
        <br />
        通話準備が整うまでこの画面を開いたままお待ちください。
      </p>
    </div>
  );
}

function renderStatus({
  meStatus,
  ahead,
  current,
  onJoin,
}: {
  ticketId: string;
  meStatus: 'WAITING' | 'IN_WAITING_ROOM' | 'IN_MAIN_ROOM' | 'DONE' | 'NO_SHOW';
  ahead: number | null;
  current: CallQueueSnapshot['current'];
  onJoin: () => void;
}) {
  if (meStatus === 'IN_MAIN_ROOM') {
    return (
      <div className="space-y-4">
        <p className="text-lg font-semibold text-emerald-700">あなたの番です!</p>
        <p className="text-sm text-slate-600">
          下のボタンから本ルームへ入室してください。タップ後にカメラ・マイクの許可ダイアログが表示されます。
        </p>
        <Button onClick={onJoin} size="lg">
          本ルームへ入室する
        </Button>
      </div>
    );
  }
  if (meStatus === 'DONE') {
    return (
      <p className="text-sm text-slate-600">
        通話は終了しました。ありがとうございました!
      </p>
    );
  }
  if (meStatus === 'NO_SHOW') {
    return (
      <p className="text-sm text-rose-700">
        運営によりスキップされました。スタッフまでお問い合わせください。
      </p>
    );
  }
  // WAITING / IN_WAITING_ROOM
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">
        順番をお待ちください。
        {ahead === null ? null : ahead === 0 ? (
          <span className="font-semibold text-brand-700"> あなたが次です。</span>
        ) : (
          <>
            {' '}
            あと <span className="font-semibold text-slate-900">{ahead}</span> 人で
            あなたの番です。
          </>
        )}
      </p>
      {current ? (
        <p className="text-xs text-slate-500">
          現在 #{current.queuePos} の方が通話中です
        </p>
      ) : (
        <p className="text-xs text-slate-500">現在 通話中の方はいません</p>
      )}
    </div>
  );
}
