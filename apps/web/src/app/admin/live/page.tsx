import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export const metadata: Metadata = { title: 'ライブ配信管理' };
export const dynamic = 'force-dynamic';

export default async function AdminLivePage() {
  const lives = await prisma.liveStream.findMany({
    orderBy: { scheduledStartAt: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      status: true,
      accessLevel: true,
      scheduledStartAt: true,
      startedAt: true,
      endedAt: true,
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">ライブ配信管理</h1>
        <Link
          href="/admin/live/new"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + 新規配信
        </Link>
      </div>
      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">タイトル</th>
                <th className="px-4 py-3">アクセス</th>
                <th className="px-4 py-3">予定日時</th>
                <th className="px-4 py-3">状態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lives.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/live/${l.id}`} className="text-brand-600 hover:underline">
                      {l.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{l.accessLevel}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {l.scheduledStartAt ? new Date(l.scheduledStartAt).toLocaleString('ja-JP') : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={
                        l.status === 'LIVE'
                          ? 'danger'
                          : l.status === 'ENDED'
                            ? 'gray'
                            : l.status === 'CANCELED'
                              ? 'warning'
                              : 'info'
                      }
                    >
                      {l.status}
                    </Badge>
                  </td>
                </tr>
              ))}
              {lives.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    配信はありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}
