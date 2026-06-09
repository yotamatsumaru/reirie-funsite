/**
 * /admin/game/scenarios — シナリオ章 一覧
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export const metadata: Metadata = { title: 'シナリオ管理' };
export const dynamic = 'force-dynamic';

export default async function AdminScenariosPage() {
  const items = await prisma.gameScenario.findMany({
    orderBy: [{ characterId: 'asc' }, { chapterNumber: 'asc' }],
    include: {
      character: { select: { id: true, name: true, slug: true } },
      _count: { select: { inventories: true } },
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">シナリオ章 管理</h1>
        <Link
          href="/admin/game/scenarios/new"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + 新規章
        </Link>
      </div>

      <div className="space-y-3 md:hidden">
        {items.length === 0 && (
          <Card>
            <CardBody className="text-center text-sm text-slate-500">章がまだありません</CardBody>
          </Card>
        )}
        {items.map((s) => (
          <Card key={s.id}>
            <CardBody className="space-y-2">
              <p className="text-xs text-slate-500">{s.character.name}</p>
              <Link
                href={`/admin/game/scenarios/${s.id}`}
                className="block font-semibold text-brand-600 hover:underline"
              >
                第{s.chapterNumber}章 {s.title}
              </Link>
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Badge tone={s.status === 'PUBLISHED' ? 'success' : 'gray'}>{s.status}</Badge>
                {s.isFreeTrial && <Badge tone="info">無料</Badge>}
                {s.isPremiumIncluded && <Badge tone="brand">PREMIUM</Badge>}
                {s.priceJpy > 0 && <Badge tone="warning">¥{s.priceJpy.toLocaleString()}</Badge>}
                <Badge tone="gray">所有 {s._count.inventories}</Badge>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card className="hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">キャラ</th>
              <th className="px-4 py-2">章</th>
              <th className="px-4 py-2">タイトル</th>
              <th className="px-4 py-2">状態</th>
              <th className="px-4 py-2 text-right">価格</th>
              <th className="px-4 py-2 text-right">所有数</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  章がまだありません
                </td>
              </tr>
            )}
            {items.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="px-4 py-2 text-slate-600">{s.character.name}</td>
                <td className="px-4 py-2 tabular-nums">第{s.chapterNumber}章</td>
                <td className="px-4 py-2 font-medium text-slate-800">{s.title}</td>
                <td className="px-4 py-2">
                  <Badge tone={s.status === 'PUBLISHED' ? 'success' : 'gray'}>{s.status}</Badge>
                  {s.isFreeTrial && <Badge tone="info" className="ml-1">無料</Badge>}
                  {s.isPremiumIncluded && <Badge tone="brand" className="ml-1">PREMIUM</Badge>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {s.priceJpy > 0 ? `¥${s.priceJpy.toLocaleString()}` : '—'}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{s._count.inventories}</td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/admin/game/scenarios/${s.id}`} className="text-brand-600 hover:underline">
                    編集
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
