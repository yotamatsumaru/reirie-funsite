import type { Metadata } from 'next';
import { prisma } from '@idol/db';
import { ItemForm } from '../item-form';

export const metadata: Metadata = { title: 'アイテム新規作成' };
export const dynamic = 'force-dynamic';

export default async function NewItemPage() {
  const characters = await prisma.gameCharacter.findMany({
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true },
  });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">アイテム新規作成</h1>
      <ItemForm mode="create" characters={characters} />
    </div>
  );
}
