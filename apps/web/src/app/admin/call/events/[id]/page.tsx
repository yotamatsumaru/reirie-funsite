/**
 * /admin/call/events/[id] — 特典会イベント詳細 (キューダッシュボード)
 *
 * - ADMIN/SUPER_ADMIN のみ (layout 側でガード)
 * - キュー一覧 + 「次のファンを呼ぶ」ボタン + シリアル発行/CSV DL
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@idol/db';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { EventControlPanel } from './EventControlPanel';

export const metadata: Metadata = { title: '特典会イベント詳細' };
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AdminCallEventDetailPage({ params }: Props) {
  const { id } = await params;
  const event = await prisma.callEvent.findUnique({
    where: { id },
    include: {
      performer: { select: { id: true, email: true, displayName: true } },
      _count: { select: { serials: true, tickets: true } },
    },
  });
  if (!event) notFound();

  const [tickets, unusedSerialCount] = await Promise.all([
    prisma.callTicket.findMany({
      where: { eventId: id },
      orderBy: { queuePos: 'asc' },
      include: { user: { select: { id: true, email: true, displayName: true } } },
    }),
    prisma.callSerial.count({ where: { eventId: id, usedById: null } }),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">
            <Link href="/admin/call/events" className="hover:underline">
              ← 特典会イベント一覧
            </Link>
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">{event.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            演者: {event.performer.displayName ?? event.performer.email} ／ 開始:{' '}
            {new Date(event.startsAt).toLocaleString('ja-JP')} ／ 1人{event.perFanSeconds}秒 ／ 状態:{' '}
            {event.status}
          </p>
        </div>
        <Link
          href={`/admin/call/events/${event.id}/main`}
          className="inline-flex items-center rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          本ルーム画面を開く →
        </Link>
      </header>

      <EventControlPanel
        eventId={event.id}
        unusedSerialCount={unusedSerialCount}
        totalSerialCount={event._count.serials}
      />

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">
            キュー ({tickets.length}人)
          </h2>
        </CardHeader>
        <CardBody className="p-0">
          {tickets.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              まだチケットは発券されていません。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">#</th>
                    <th className="px-4 py-2 font-medium">ファン</th>
                    <th className="px-4 py-2 font-medium">状態</th>
                    <th className="px-4 py-2 font-medium">入室時刻</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tickets.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-slate-700">{t.queuePos}</td>
                      <td className="px-4 py-2 text-slate-700">
                        {t.user.displayName ?? t.user.email}
                      </td>
                      <td className="px-4 py-2">
                        <TicketStatusBadge status={t.status} />
                      </td>
                      <td className="px-4 py-2 text-slate-500">
                        {t.enteredMainAt
                          ? new Date(t.enteredMainAt).toLocaleTimeString('ja-JP')
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function TicketStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    WAITING: 'bg-slate-100 text-slate-700',
    IN_WAITING_ROOM: 'bg-sky-100 text-sky-700',
    IN_MAIN_ROOM: 'bg-emerald-100 text-emerald-700',
    DONE: 'bg-slate-100 text-slate-500',
    NO_SHOW: 'bg-rose-100 text-rose-700',
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? 'bg-slate-100 text-slate-700'}`}
    >
      {status}
    </span>
  );
}
