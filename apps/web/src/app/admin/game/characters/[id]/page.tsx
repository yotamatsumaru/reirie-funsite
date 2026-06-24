/**
 * /admin/game/characters/[id] — キャラクター編集
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@idol/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { CharacterForm } from '../character-form';
import { requireCapabilityPage } from '@/auth';

export const dynamic = 'force-dynamic';

export default async function EditCharacterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCapabilityPage('GAME');
  const { id } = await params;
  const character = await prisma.gameCharacter.findUnique({
    where: { id },
    include: { scenarios: { orderBy: { chapterNumber: 'asc' } } },
  });
  if (!character) notFound();

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin/game/characters" className="text-xs text-slate-500 hover:underline">
          ← キャラクター一覧
        </Link>
        <h1 className="mt-2 text-xl font-bold text-slate-800 sm:text-2xl">{character.name}</h1>
        <p className="mt-1 text-xs text-slate-500">{character.slug}</p>
      </div>

      <CharacterForm mode="edit" id={character.id} initial={character} />

      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-800">章一覧</h2>
            <Link
              href={`/admin/game/scenarios/new?characterId=${character.id}`}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
            >
              + 新規章
            </Link>
          </div>
          {character.scenarios.length === 0 ? (
            <p className="text-sm text-slate-500">章がまだありません</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {character.scenarios.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2"
                >
                  <Link href={`/admin/game/scenarios/${s.id}`} className="text-brand-600 hover:underline">
                    第{s.chapterNumber}章 {s.title}
                  </Link>
                  <div className="flex gap-1.5">
                    <Badge tone={s.status === 'PUBLISHED' ? 'success' : 'gray'}>
                      {s.status}
                    </Badge>
                    {s.isFreeTrial && <Badge tone="info">無料</Badge>}
                    {s.isPremiumIncluded && <Badge tone="brand">PREMIUM</Badge>}
                    {s.priceJpy > 0 && (
                      <span className="text-xs text-slate-600">¥{s.priceJpy.toLocaleString()}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
