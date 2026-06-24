/**
 * /admin/game/scenarios/[id] — シナリオ章 編集
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { ScenarioForm } from '../scenario-form';
import { requireCapabilityPage } from '@/auth';

export const dynamic = 'force-dynamic';

export default async function EditScenarioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCapabilityPage('GAME');
  const { id } = await params;
  const [scenario, characters] = await Promise.all([
    prisma.gameScenario.findUnique({
      where: { id },
      include: { character: { select: { id: true, name: true, slug: true } } },
    }),
    prisma.gameCharacter.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, slug: true },
    }),
  ]);
  if (!scenario) notFound();

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/game/scenarios" className="text-xs text-slate-500 hover:underline">
          ← シナリオ一覧
        </Link>
        <h1 className="mt-2 text-xl font-bold text-slate-800 sm:text-2xl">
          {scenario.character.name} 第{scenario.chapterNumber}章 — {scenario.title}
        </h1>
      </div>
      <ScenarioForm
        mode="edit"
        id={scenario.id}
        initial={{
          characterId: scenario.characterId,
          slug: scenario.slug,
          chapterNumber: scenario.chapterNumber,
          title: scenario.title,
          summary: scenario.summary,
          scriptJson: scenario.scriptJson,
          priceJpy: scenario.priceJpy,
          isFreeTrial: scenario.isFreeTrial,
          isPremiumIncluded: scenario.isPremiumIncluded,
          status: scenario.status,
          requiredAffinity: scenario.requiredAffinity,
          estimatedMinutes: scenario.estimatedMinutes,
        }}
        characters={characters}
      />
    </div>
  );
}
