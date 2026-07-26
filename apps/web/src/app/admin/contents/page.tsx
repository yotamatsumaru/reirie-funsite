import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { requireCapabilityPage } from '@/auth';
import { formatJstDateTime } from '@idol/shared';

export const metadata: Metadata = { title: 'コンテンツ管理' };
export const dynamic = 'force-dynamic';

/** ContentType を日本語ラベルに変換 */
const TYPE_LABEL: Record<string, string> = { BLOG: 'ブログ', GALLERY: 'ギャラリー' };
function typeLabel(t: string): string {
  return TYPE_LABEL[t] ?? t;
}

export default async function AdminContentsPage() {
  await requireCapabilityPage('CONTENT');
  const items = await prisma.content.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      slug: true,
      title: true,
      type: true,
      status: true,
      accessLevel: true,
      publishedAt: true,
      updatedAt: true,
      viewCount: true,
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">コンテンツ管理</h1>
        <Link
          href="/admin/contents/new"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + 新規作成
        </Link>
      </div>

      {/* モバイル: カードリスト */}
      <div className="space-y-3 md:hidden">
        {items.length === 0 ? (
          <Card>
            <CardBody className="text-center text-sm text-slate-500">
              コンテンツはありません
            </CardBody>
          </Card>
        ) : (
          items.map((c) => (
            <Card key={c.id}>
              <CardBody className="space-y-2">
                <Link
                  href={`/admin/contents/${c.id}`}
                  className="block font-semibold text-brand-600 hover:underline"
                >
                  {c.title}
                </Link>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <Badge tone="gray">{typeLabel(c.type)}</Badge>
                  <Badge tone={c.accessLevel === 'PREMIUM' ? 'brand' : c.accessLevel === 'MEMBERS' ? 'info' : 'gray'}>
                    {c.accessLevel}
                  </Badge>
                  <Badge tone={c.status === 'PUBLISHED' ? 'success' : 'gray'}>{c.status}</Badge>
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>閲覧 {c.viewCount}</span>
                  <span>{formatJstDateTime(c.updatedAt)}</span>
                </div>
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
                <th className="px-4 py-3">種別</th>
                <th className="px-4 py-3">アクセス</th>
                <th className="px-4 py-3">状態</th>
                <th className="px-4 py-3">閲覧数</th>
                <th className="px-4 py-3">更新</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/admin/contents/${c.id}`} className="text-brand-600 hover:underline">
                      {c.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{typeLabel(c.type)}</td>
                  <td className="px-4 py-3">{c.accessLevel}</td>
                  <td className="px-4 py-3">
                    <Badge tone={c.status === 'PUBLISHED' ? 'success' : 'gray'}>{c.status}</Badge>
                  </td>
                  <td className="px-4 py-3">{c.viewCount}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {formatJstDateTime(c.updatedAt)}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    コンテンツはありません
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
