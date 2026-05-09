import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export const metadata: Metadata = { title: '動画管理' };
export const dynamic = 'force-dynamic';

export default async function AdminVideosPage() {
  const videos = await prisma.video.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      status: true,
      accessLevel: true,
      durationSeconds: true,
      publishedAt: true,
      createdAt: true,
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">動画管理</h1>
        <Link
          href="/admin/videos/new"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + アップロード
        </Link>
      </div>
      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">タイトル</th>
                <th className="px-4 py-3">アクセス</th>
                <th className="px-4 py-3">尺</th>
                <th className="px-4 py-3">状態</th>
                <th className="px-4 py-3">作成</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {videos.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/videos/${v.id}`} className="text-brand-600 hover:underline">
                      {v.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{v.accessLevel}</td>
                  <td className="px-4 py-3">
                    {v.durationSeconds ? `${Math.floor(v.durationSeconds / 60)}分` : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={
                        v.status === 'READY'
                          ? 'success'
                          : v.status === 'FAILED'
                            ? 'danger'
                            : 'info'
                      }
                    >
                      {v.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(v.createdAt).toLocaleString('ja-JP')}
                  </td>
                </tr>
              ))}
              {videos.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    動画はありません
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
