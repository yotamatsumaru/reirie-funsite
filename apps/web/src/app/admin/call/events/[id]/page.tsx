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
import { TicketRow } from './TicketRow';

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
        eventStatus={event.status}
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
                    <th className="px-4 py-2 font-medium">経過 / 入室</th>
                    <th className="px-4 py-2 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tickets.map((t) => (
                    <TicketRow
                      key={t.id}
                      eventId={event.id}
                      ticketId={t.id}
                      queuePos={t.queuePos}
                      userLabel={t.user.displayName ?? t.user.email}
                      status={t.status}
                      enteredMainAt={
                        t.enteredMainAt ? t.enteredMainAt.toISOString() : null
                      }
                      perFanSeconds={event.perFanSeconds}
                    />
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
