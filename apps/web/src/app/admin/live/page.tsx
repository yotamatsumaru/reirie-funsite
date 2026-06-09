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

  const tone = (status: string) =>
    status === 'LIVE'
      ? 'danger'
      : status === 'ENDED'
        ? 'gray'
        : status === 'CANCELED'
          ? 'warning'
          : 'info';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">ライブ配信管理</h1>
        <Link
          href="/admin/live/new"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + 新規配信
        </Link>
      </div>

      {/* モバイル: カードリスト */}
      <div className="space-y-3 md:hidden">
        {lives.length === 0 ? (
          <Card>
            <CardBody className="text-center text-sm text-slate-500">配信はありません</CardBody>
          </Card>
        ) : (
          lives.map((l) => (
            <Card key={l.id}>
              <CardBody className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/admin/live/${l.id}`}
                    className="font-semibold text-brand-600 hover:underline"
                  >
                    {l.title}
                  </Link>
                  <Badge tone={tone(l.status)}>{l.status}</Badge>
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <Badge tone="gray">{l.accessLevel}</Badge>
                </div>
                <p className="text-xs text-slate-500">
                  {l.scheduledStartAt
                    ? new Date(l.scheduledStartAt).toLocaleString('ja-JP')
                    : '-'}
                </p>
              </CardBody>
            </Card>
          ))
        )}
      </div>

      {/* デスクトップ: テーブル */}
      <Card className="hidden md:block">
        <CardBody className="overflow-x-auto p-0">
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
                    {l.scheduledStartAt
                      ? new Date(l.scheduledStartAt).toLocaleString('ja-JP')
                      : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={tone(l.status)}>{l.status}</Badge>
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
