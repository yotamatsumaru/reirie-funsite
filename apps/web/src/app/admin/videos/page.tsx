import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { requireCapabilityPage } from '@/auth';
import { formatJstDateTime } from '@idol/shared';
import { videoPublishState } from '@/lib/video-visibility';

export const metadata: Metadata = { title: '動画管理' };
export const dynamic = 'force-dynamic';

export default async function AdminVideosPage() {
  await requireCapabilityPage('CONTENT');
  const videos = await prisma.video.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      status: true,
      isPublished: true,
      accessLevel: true,
      durationSeconds: true,
      publishedAt: true,
      expiresAt: true,
      createdAt: true,
    },
  });

  const tone = (status: string) =>
    status === 'READY' ? 'success' : status === 'FAILED' ? 'danger' : 'info';

  // isPublished だけで「公開中」と出すと、公開予約中・期限切れ・
  // 公開日時未設定のどれも「公開中」に見えてしまう。
  // 実際に会員側に出ているかを 1 つのバッジで表す。
  const now = new Date();
  const publishBadge = (v: {
    isPublished: boolean;
    status: string;
    publishedAt: Date | null;
    expiresAt: Date | null;
  }): { label: string; tone: 'success' | 'gray' | 'warning' | 'danger' | 'info' } => {
    switch (
      videoPublishState(
        {
          isPublished: v.isPublished,
          status: v.status,
          publishedAt: v.publishedAt,
          expiresAt: v.expiresAt,
          // バッジの判定に accessLevel は使わない（型を満たすためのダミー）
          accessLevel: 'PUBLIC',
        },
        now,
      )
    ) {
      case 'unpublished':
        return { label: '非公開', tone: 'gray' };
      case 'encoding':
        return { label: 'エンコード待ち', tone: 'info' };
      case 'scheduled':
        return { label: '公開予約中', tone: 'warning' };
      case 'expired':
        return { label: '配信終了', tone: 'danger' };
      case 'no_date':
        return { label: '公開日時未設定', tone: 'warning' };
      default:
        return { label: '公開中', tone: 'success' };
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">動画管理</h1>
        <Link
          href="/admin/videos/new"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + アップロード
        </Link>
      </div>

      {/* モバイル: カードリスト */}
      <div className="space-y-3 md:hidden">
        {videos.length === 0 ? (
          <Card>
            <CardBody className="text-center text-sm text-slate-500">動画はありません</CardBody>
          </Card>
        ) : (
          videos.map((v) => (
            <Card key={v.id}>
              <CardBody className="space-y-2">
                <Link
                  href={`/admin/videos/${v.id}`}
                  className="block font-semibold text-brand-600 hover:underline"
                >
                  {v.title}
                </Link>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <Badge tone={publishBadge(v).tone}>{publishBadge(v).label}</Badge>
                  <Badge tone="gray">{v.accessLevel}</Badge>
                  <Badge tone={tone(v.status)}>{v.status}</Badge>
                  {v.durationSeconds && (
                    <Badge tone="gray">{Math.floor(v.durationSeconds / 60)}分</Badge>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  {formatJstDateTime(v.createdAt)}
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
                <th className="px-4 py-3">公開</th>
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
                  <td className="px-4 py-3">
                    <Badge tone={publishBadge(v).tone}>{publishBadge(v).label}</Badge>
                    {/* 予約中は「いつ公開されるか」が分からないと確認のために
                        詳細を開かなければならないので、一覧に日時も出す。 */}
                    {publishBadge(v).label === '公開予約中' && v.publishedAt && (
                      <p className="mt-1 text-xs text-slate-500">
                        {formatJstDateTime(v.publishedAt)} から
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">{v.accessLevel}</td>
                  <td className="px-4 py-3">
                    {v.durationSeconds ? `${Math.floor(v.durationSeconds / 60)}分` : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={tone(v.status)}>{v.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {formatJstDateTime(v.createdAt)}
                  </td>
                </tr>
              ))}
              {videos.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
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
