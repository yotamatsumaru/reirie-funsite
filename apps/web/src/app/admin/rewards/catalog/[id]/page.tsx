import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { CatalogForm } from '../catalog-form';
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
          pointCost: item.pointCost,
          stock: item.stock,
          status: item.status,
          sortOrder: item.sortOrder,
        }}
      />
    </div>
  );
}
