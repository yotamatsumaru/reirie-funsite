/**
 * /admin/game/players — プレイヤー進捗一覧 (運営調査用)
 */
import type { Metadata } from 'next';
import { prisma } from '@idol/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { requireCapabilityPage } from '@/auth';
import { formatJstDateTime } from '@idol/shared';

export const metadata: Metadata = { title: 'プレイヤー進捗' };
export const dynamic = 'force-dynamic';

const ROUTE_LABEL: Record<string, string> = {
  IN_PROGRESS: '進行中',
  FRIEND_END: '友情END',
  LOVE_END: '恋愛END',
  SPECIAL_END: 'スペシャルEND',
  BAD_END: 'バッドEND',
};

export default async function AdminPlayersPage() {
  await requireCapabilityPage('GAME');
  const items = await prisma.playerProgress.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 100,
    include: {
      user: { select: { id: true, email: true, displayName: true } },
      character: { select: { id: true, name: true, slug: true } },
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">プレイヤー進捗</h1>

      <div className="space-y-3 md:hidden">
        {items.length === 0 && (
          <Card>
            <CardBody className="text-center text-sm text-slate-500">
              プレイヤー進捗はありません
            </CardBody>
          </Card>
        )}
        {items.map((p) => (
          <Card key={p.id}>
            <CardBody className="space-y-1.5">
              <p className="text-sm font-semibold text-slate-800">
                {p.user.displayName ?? p.user.email}
              </p>
              <p className="text-xs text-slate-500">{p.user.email}</p>
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Badge tone="info">{p.character.name}</Badge>
                <Badge tone="brand">親密度 {p.affinity}</Badge>
                <Badge tone="gray">{ROUTE_LABEL[p.routeResult] ?? p.routeResult}</Badge>
                <Badge tone="success">{p.totalPlayMinutes} 分</Badge>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card className="hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">ユーザー</th>
              <th className="px-4 py-2">キャラ</th>
              <th className="px-4 py-2 text-right">親密度</th>
              <th className="px-4 py-2">ルート</th>
              <th className="px-4 py-2 text-right">プレイ時間</th>
              <th className="px-4 py-2">最終更新</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  プレイヤー進捗はありません
                </td>
              </tr>
            )}
            {items.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-4 py-2">
                  <div className="font-medium text-slate-800">
                    {p.user.displayName ?? '-'}
                  </div>
                  <div className="text-xs text-slate-500">{p.user.email}</div>
                </td>
                <td className="px-4 py-2 text-slate-600">{p.character.name}</td>
                <td className="px-4 py-2 text-right tabular-nums">{p.affinity}</td>
                <td className="px-4 py-2">
                  <Badge tone={p.routeResult === 'IN_PROGRESS' ? 'gray' : 'brand'}>
                    {ROUTE_LABEL[p.routeResult] ?? p.routeResult}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{p.totalPlayMinutes} 分</td>
                <td className="px-4 py-2 text-xs text-slate-500">
                  {formatJstDateTime(p.updatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
