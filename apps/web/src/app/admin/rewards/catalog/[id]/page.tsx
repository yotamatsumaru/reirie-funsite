import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { CatalogForm } from '../catalog-form';
import { DigitalAssetsManager } from '../digital-assets-manager';
import { Card, CardBody } from '@/components/ui/Card';
import { getDownloadStat } from '@/lib/reward-download-stats';
import { requireCapabilityPage } from '@/auth';

export const dynamic = 'force-dynamic';

export default async function EditCatalogItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCapabilityPage('MERCH');
  const { id } = await params;
  const item = await prisma.rewardCatalogItem.findUnique({ where: { id } });
  if (!item) notFound();

  const isDigital = item.kind === 'DIGITAL';

  const [digitalAssets, downloadStat] = await Promise.all([
    isDigital
      ? prisma.rewardDigitalAsset.findMany({
          where: { catalogItemId: id },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            fileName: true,
            contentType: true,
            fileSize: true,
            sortOrder: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
    isDigital ? getDownloadStat(id) : Promise.resolve({ total: 0, unique: 0 }),
  ]);
  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/rewards/catalog" className="text-xs text-slate-500 hover:underline">
          ← 景品カタログ一覧
        </Link>
        <h1 className="mt-2 text-xl font-bold text-slate-800 sm:text-2xl">{item.name}</h1>
      </div>
      <CatalogForm
        mode="edit"
        id={item.id}
        initial={{
          slug: item.slug,
          kind: item.kind,
          name: item.name,
          description: item.description,
          imageUrl: item.imageUrl,
          puiCost: item.puiCost,
          stock: item.stock,
          status: item.status,
          sortOrder: item.sortOrder,
        }}
      />

      {isDigital && (
        <Card>
          <CardBody>
            <h2 className="text-sm font-bold text-slate-900">ダウンロード数</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              この景品のデジタル特典が会員にダウンロードされた実績です。
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs text-slate-500">延べダウンロード</p>
                <p className="mt-0.5 text-2xl font-bold text-slate-900">
                  {downloadStat.total.toLocaleString()}
                  <span className="ml-1 text-sm font-medium text-slate-400">回</span>
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs text-slate-500">ダウンロードした人数</p>
                <p className="mt-0.5 text-2xl font-bold text-slate-900">
                  {downloadStat.unique.toLocaleString()}
                  <span className="ml-1 text-sm font-medium text-slate-400">人</span>
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {isDigital && (
        <DigitalAssetsManager
          catalogItemId={item.id}
          initialAssets={digitalAssets.map((a) => ({
            ...a,
            createdAt: a.createdAt.toISOString(),
          }))}
        />
      )}
    </div>
  );
}
