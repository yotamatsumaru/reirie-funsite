/**
 * /admin/game/items — アイテム / プレゼント 管理
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export const metadata: Metadata = { title: 'アイテム管理' };
export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  GIFT: 'プレゼント',
  COSMETIC: '衣装',
  CG_PACK: 'CG パック',
  VOICE_PACK: 'ボイスパック',
};

export default async function AdminItemsPage() {
  const items = await prisma.gameItem.findMany({
    orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }],
    include: { character: { select: { name: true } } },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">アイテム / プレゼント</h1>
        <Link
          href="/admin/game/items/new"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + 新規アイテム
        </Link>
      </div>

      <div className="space-y-3 md:hidden">
        {items.length === 0 && (
          <Card>
            <CardBody className="text-center text-sm text-slate-500">
              アイテムがありません
            </CardBody>
          </Card>
        )}
        {items.map((it) => (
          <Card key={it.id}>
            <CardBody className="space-y-2">
              <Link
                href={`/admin/game/items/${it.id}`}
                className="block font-semibold text-brand-600 hover:underline"
              >
                {it.name}
              </Link>
              <p className="text-xs text-slate-400">{it.slug}</p>
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Badge tone="info">{KIND_LABEL[it.kind] ?? it.kind}</Badge>
                {it.character && <Badge tone="gray">{it.character.name}</Badge>}
                {it.kind === 'GIFT' && (
                  <Badge tone="brand">親密度 +{it.affinityBoost}</Badge>
                )}
                <Badge tone={it.isActive ? 'success' : 'gray'}>
                  {it.isActive ? '販売中' : '停止'}
                </Badge>
                {it.priceJpy > 0 && (
                  <span className="text-xs text-slate-600">¥{it.priceJpy.toLocaleString()}</span>
                )}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card className="hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">名前</th>
              <th className="px-4 py-2">種別</th>
              <th className="px-4 py-2">対象キャラ</th>
              <th className="px-4 py-2 text-right">価格</th>
              <th className="px-4 py-2 text-right">親密度</th>
              <th className="px-4 py-2">状態</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  アイテムがありません
                </td>
              </tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-slate-800">{it.name}</td>
                <td className="px-4 py-2">{KIND_LABEL[it.kind] ?? it.kind}</td>
                <td className="px-4 py-2 text-slate-500">{it.character?.name ?? '全キャラ共通'}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  ¥{it.priceJpy.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {it.kind === 'GIFT' ? `+${it.affinityBoost}` : '—'}
                </td>
                <td className="px-4 py-2">
                  <Badge tone={it.isActive ? 'success' : 'gray'}>
                    {it.isActive ? '販売中' : '停止'}
                  </Badge>
                  {it.isPremiumOnly && <Badge tone="brand" className="ml-1">PREMIUM</Badge>}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/admin/game/items/${it.id}`} className="text-brand-600 hover:underline">
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
