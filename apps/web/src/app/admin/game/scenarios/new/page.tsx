/**
 * /admin/game/scenarios/new — 新規シナリオ作成
 */
import type { Metadata } from 'next';
import { prisma } from '@idol/db';
import { ScenarioForm } from '../scenario-form';
import { requireCapabilityPage } from '@/auth';

export const metadata: Metadata = { title: 'シナリオ章 新規作成' };
export const dynamic = 'force-dynamic';

export default async function NewScenarioPage({
  searchParams,
}: {
  searchParams: Promise<{ characterId?: string }>;
}) {
  await requireCapabilityPage('GAME');
  const { characterId } = await searchParams;
  const characters = await prisma.gameCharacter.findMany({
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, slug: true },
  });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">シナリオ章 新規作成</h1>
      <ScenarioForm
        mode="create"
        characters={characters}
        defaultCharacterId={characterId}
      />
    </div>
  );
}
