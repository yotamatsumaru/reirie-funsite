/**
 * /game/[characterSlug] — キャラ詳細 + 章一覧 + 自分の進捗
 */
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ChapterPurchaseButton } from './chapter-purchase-button';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ characterSlug: string }>;
}): Promise<Metadata> {
  const { characterSlug } = await params;
  const c = await prisma.gameCharacter.findUnique({
    where: { slug: characterSlug },
    select: { name: true, catchcopy: true },
  });
  return {
    title: c ? `${c.name} — 恋愛 ADV` : 'キャラクター',
    description: c?.catchcopy ?? undefined,
  };
}

export default async function CharacterDetailPage({
  params,
}: {
  params: Promise<{ characterSlug: string }>;
}) {
  const { characterSlug } = await params;
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isPremium = session?.user?.plan === 'PREMIUM';

  const character = await prisma.gameCharacter.findUnique({
    where: { slug: characterSlug },
    include: {
      scenarios: {
        where: { status: 'PUBLISHED' },
        orderBy: { chapterNumber: 'asc' },
      },
    },
  });
  if (!character || character.status !== 'PUBLISHED') notFound();
  if (character.isPremiumOnly && !isPremium) {
    redirect('/me/subscription?from=/game/' + characterSlug);
  }

  let progress: { affinity: number; routeResult: string } | null = null;
  let ownedScenarioIds = new Set<string>();
  if (userId) {
    const [p, inv] = await Promise.all([
      prisma.playerProgress.findUnique({
        where: { userId_characterId: { userId, characterId: character.id } },
        select: { affinity: true, routeResult: true },
      }),
      prisma.playerInventory.findMany({
        where: { userId, scenarioId: { not: null } },
        select: { scenarioId: true },
      }),
    ]);
    progress = p;
    ownedScenarioIds = new Set(inv.map((i) => i.scenarioId).filter((x): x is string => !!x));
  }

  return (
    <main className="mx-auto max-w-4xl px-3 py-6 sm:px-4 sm:py-10">
      <Link href="/game" className="text-xs text-slate-500 hover:underline">
        ← キャラクター一覧
      </Link>

      <section className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[200px_1fr] sm:gap-6">
        <div
          className="aspect-[3/4] overflow-hidden rounded-xl"
          style={{ backgroundColor: character.themeColor ?? '#fce7f3' }}
        >
          {character.portraitUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={character.portraitUrl}
              alt={character.name}
              className="h-full w-full object-cover"
            />
          )}
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">{character.name}</h1>
          {character.furigana && <p className="text-sm text-slate-500">{character.furigana}</p>}
          {character.catchcopy && (
            <p className="text-sm text-brand-600 sm:text-base">{character.catchcopy}</p>
          )}
          <div className="flex flex-wrap gap-3 text-xs text-slate-600">
            {character.age && <span>年齢: {character.age}</span>}
            {character.birthday && <span>誕生日: {character.birthday}</span>}
            {character.bloodType && <span>血液型: {character.bloodType}</span>}
            {character.height && <span>身長: {character.height}cm</span>}
          </div>
          {character.description && (
            <p className="mt-2 whitespace-pre-line text-sm text-slate-700">
              {character.description}
            </p>
          )}
          {progress && (
            <Card className="mt-3">
              <CardBody className="space-y-2">
                <p className="text-xs font-semibold text-slate-500">あなたの進捗</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">親密度</span>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full bg-gradient-to-r from-pink-400 to-rose-500"
                      style={{ width: `${progress.affinity}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-slate-800">
                    {progress.affinity}
                  </span>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold text-slate-800 sm:text-xl">章一覧</h2>
        <ul className="mt-3 space-y-3">
          {character.scenarios.length === 0 && (
            <Card>
              <CardBody className="py-8 text-center text-sm text-slate-500">
                章は準備中です
              </CardBody>
            </Card>
          )}
          {character.scenarios.map((s) => {
            const owned = ownedScenarioIds.has(s.id);
            const includedByPremium = s.isPremiumIncluded && isPremium;
            const isFree = s.priceJpy === 0 || s.isFreeTrial;
            const playable = isFree || owned || includedByPremium;
            const lockedByAffinity =
              s.requiredAffinity > 0 && (progress?.affinity ?? 0) < s.requiredAffinity;
            return (
              <Card key={s.id}>
                <CardBody className="space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="text-xs text-slate-500">第{s.chapterNumber}章</p>
                      <p className="text-base font-bold text-slate-900 sm:text-lg">{s.title}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {s.isFreeTrial && <Badge tone="info">無料体験</Badge>}
                      {s.isPremiumIncluded && <Badge tone="brand">PREMIUM 同梱</Badge>}
                      {owned && <Badge tone="success">購入済</Badge>}
                      {s.estimatedMinutes && (
                        <Badge tone="gray">約 {s.estimatedMinutes}分</Badge>
                      )}
                    </div>
                  </div>
                  {s.summary && (
                    <p className="text-sm text-slate-600 sm:text-base">{s.summary}</p>
                  )}
                  {lockedByAffinity && (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      🔒 親密度 {s.requiredAffinity} 以上で解放されます (現在: {progress?.affinity ?? 0})
                    </p>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                    <p className="text-sm font-semibold text-slate-800">
                      {isFree ? '無料' : `¥${s.priceJpy.toLocaleString()}`}
                    </p>
                    {playable ? (
                      lockedByAffinity ? (
                        <button
                          type="button"
                          disabled
                          className="rounded-md bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-500"
                        >
                          解放条件未達
                        </button>
                      ) : (
                        <Link
                          href={`/game/play/${s.id}`}
                          className="inline-flex min-h-[40px] items-center rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                        >
                          {owned || includedByPremium ? '続きから読む' : '読む'}
                        </Link>
                      )
                    ) : (
                      <ChapterPurchaseButton scenarioId={s.id} priceJpy={s.priceJpy} />
                    )}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
