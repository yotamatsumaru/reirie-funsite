/**
 * /admin/game/characters — キャラクター一覧
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export const metadata: Metadata = { title: 'キャラクター管理' };
export const dynamic = 'force-dynamic';

const statusTone = {
  DRAFT: 'gray',
  PUBLISHED: 'success',
  ARCHIVED: 'warning',
} as const;

export default async function AdminGameCharactersPage() {
  const items = await prisma.gameCharacter.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    include: { _count: { select: { scenarios: true, progresses: true } } },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">キャラクター管理</h1>
        <Link
          href="/admin/game/characters/new"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + 新規キャラ
        </Link>
      </div>

      {/* モバイル: カード */}
      <div className="space-y-3 md:hidden">
        {items.length === 0 && (
          <Card>
            <CardBody className="text-center text-sm text-slate-500">キャラクターがありません</CardBody>
          </Card>
        )}
        {items.map((c) => (
          <Card key={c.id}>
            <CardBody className="space-y-2">
              <Link
                href={`/admin/game/characters/${c.id}`}
                className="block font-semibold text-brand-600 hover:underline"
              >
                {c.name}
              </Link>
              <p className="text-xs text-slate-400">{c.slug}</p>
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Badge tone={statusTone[c.status]}>{c.status}</Badge>
                {c.isPremiumOnly && <Badge tone="brand">PREMIUM</Badge>}
                <Badge tone="info">章 {c._count.scenarios}</Badge>
                <Badge tone="gray">プレイヤー {c._count.progresses}</Badge>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* デスクトップ: テーブル */}
      <Card className="hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">名前</th>
              <th className="px-4 py-2">slug</th>
              <th className="px-4 py-2">状態</th>
              <th className="px-4 py-2 text-right">章数</th>
              <th className="px-4 py-2 text-right">プレイヤー</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  キャラクターがありません
                </td>
              </tr>
            )}
            {items.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-slate-800">{c.name}</td>
                <td className="px-4 py-2 text-slate-500">{c.slug}</td>
                <td className="px-4 py-2">
                  <Badge tone={statusTone[c.status]}>{c.status}</Badge>
                  {c.isPremiumOnly && <Badge tone="brand" className="ml-1">PREMIUM</Badge>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{c._count.scenarios}</td>
                <td className="px-4 py-2 text-right tabular-nums">{c._count.progresses}</td>
                <td className="px-4 py-2 text-right">
                  <Link
                    href={`/admin/game/characters/${c.id}`}
                    className="text-brand-600 hover:underline"
                  >
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
