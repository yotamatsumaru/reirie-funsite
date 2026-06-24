/**
 * /admin/call/events — 特典会イベント一覧 + 新規作成
 *
 * - ADMIN/SUPER_ADMIN のみ (layout 側でガード)
 * - 一覧はサーバーコンポーネントで Prisma 直 fetch
 * - 作成フォームは Client Component
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { CreateEventForm } from './CreateEventForm';
import { requireCapabilityPage } from '@/auth';

export const metadata: Metadata = { title: '特典会イベント一覧' };
export const dynamic = 'force-dynamic';

export default async function AdminCallEventsPage() {
  await requireCapabilityPage('CALL');
  const [events, performers] = await Promise.all([
    prisma.callEvent.findMany({
      orderBy: { startsAt: 'desc' },
      include: {
        performer: { select: { id: true, email: true, displayName: true } },
        _count: { select: { serials: true, tickets: true } },
      },
    }),
    prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
      select: { id: true, email: true, displayName: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">特典会イベント</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          CD 同梱シリアルを使った 1on1 特典会のイベントを管理します。
        </p>
      </header>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">新規イベントを作成</h2>
        </CardHeader>
        <CardBody>
          <CreateEventForm
            performers={performers.map((p) => ({
              id: p.id,
              label: p.displayName ? `${p.displayName} (${p.email})` : p.email,
            }))}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">イベント一覧</h2>
        </CardHeader>
        <CardBody className="p-0">
          {events.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              まだイベントがありません。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">タイトル</th>
                    <th className="px-4 py-2 font-medium">演者</th>
                    <th className="px-4 py-2 font-medium">開始</th>
                    <th className="px-4 py-2 font-medium">状態</th>
                    <th className="px-4 py-2 font-medium">シリアル</th>
                    <th className="px-4 py-2 font-medium">参加者</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {events.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-medium text-slate-900">{e.title}</td>
                      <td className="px-4 py-2 text-slate-600">
                        {e.performer.displayName ?? e.performer.email}
                      </td>
                      <td className="px-4 py-2 text-slate-600">
                        {new Date(e.startsAt).toLocaleString('ja-JP')}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={e.status} />
                      </td>
                      <td className="px-4 py-2 text-slate-600">{e._count.serials}</td>
                      <td className="px-4 py-2 text-slate-600">{e._count.tickets}</td>
                      <td className="px-4 py-2 text-right">
                        <Link
                          href={`/admin/call/events/${e.id}`}
                          className="text-brand-600 hover:underline"
                        >
                          詳細
                        </Link>
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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    SCHEDULED: 'bg-slate-100 text-slate-700',
    LIVE: 'bg-emerald-100 text-emerald-700',
    ENDED: 'bg-slate-100 text-slate-500',
    CANCELED: 'bg-rose-100 text-rose-700',
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? 'bg-slate-100 text-slate-700'}`}
    >
      {status}
    </span>
  );
}
