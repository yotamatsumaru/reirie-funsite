import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { ItemForm } from '../item-form';

export const dynamic = 'force-dynamic';

export default async function EditItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [item, characters] = await Promise.all([
    prisma.gameItem.findUnique({ where: { id } }),
    prisma.gameCharacter.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true },
    }),
  ]);
  if (!item) notFound();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/game/items" className="text-xs text-slate-500 hover:underline">
          ← アイテム一覧
        </Link>
        <h1 className="mt-2 text-xl font-bold text-slate-800 sm:text-2xl">{item.name}</h1>
      </div>
      <ItemForm
        mode="edit"
        id={item.id}
        initial={{
          slug: item.slug,
          characterId: item.characterId,
          kind: item.kind,
          name: item.name,
          description: item.description,
          iconUrl: item.iconUrl,
          priceJpy: item.priceJpy,
          isPremiumOnly: item.isPremiumOnly,
          affinityBoost: item.affinityBoost,
          maxOwn: item.maxOwn,
          isActive: item.isActive,
          sortOrder: item.sortOrder,
        }}
        characters={characters}
      />
    </div>
  );
}
