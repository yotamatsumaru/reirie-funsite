/**
 * /game/play/[scenarioId] — シナリオ再生ページ
 *
 * Server Component で初期データをフェッチ → クライアントコンポーネントへ受け渡し
 */
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { validateScenarioScript } from '@idol/shared';
import { resolveGameVisibility } from '@/lib/game-visibility';
import { GamePlayerClient } from './game-player-client';

export const dynamic = 'force-dynamic';

export default async function GamePlayPage({
  params,
}: {
  params: Promise<{ scenarioId: string }>;
}) {
  const { scenarioId } = await params;
  // 非公開中は一般会員には 404。管理者だけはプレビューとしてプレイできる。
  // （未ログインでもまずここで 404 にし、サインイン画面へ送って
  //   「ログインすれば遊べるゲームがある」と推測させない）
  const { canView } = await resolveGameVisibility('story');
  if (!canView) notFound();

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/signin?callbackUrl=/game/play/${scenarioId}`);
  }
  const userId = session.user.id;
  const isPremium = session.user.plan === 'PREMIUM';

  const scenario = await prisma.gameScenario.findUnique({
    where: { id: scenarioId },
    include: {
      character: {
        select: {
          id: true,
          slug: true,
          name: true,
          spriteUrl: true,
          isPremiumOnly: true,
          status: true,
        },
      },
    },
  });
  if (!scenario || scenario.status !== 'PUBLISHED') notFound();
  if (scenario.character.status !== 'PUBLISHED') notFound();

  // アクセス判定
  const inv = await prisma.playerInventory.findUnique({
    where: { userId_scenarioId: { userId, scenarioId: scenario.id } },
  });
  const owned = !!inv;
  const includedByPremium = scenario.isPremiumIncluded && isPremium;
  const playable = scenario.isFreeTrial || owned || includedByPremium;
  if (!playable) {
    redirect(`/game/${scenario.character.slug}`);
  }
  if (scenario.character.isPremiumOnly && !isPremium) {
    redirect(`/me/subscription?from=/game/play/${scenarioId}`);
  }

  // script 検証
  const validation = validateScenarioScript(scenario.scriptJson);
  if (!validation.ok) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center">
        <p className="text-sm text-rose-700">
          シナリオデータの検証に失敗しました。運営にお問い合わせください。
        </p>
      </div>
    );
  }

  // アセット
  const assets = await prisma.gameAsset.findMany({
    where: {
      OR: [{ characterId: scenario.character.id }, { characterId: null }],
    },
    select: { kind: true, key: true, url: true },
  });
  const assetIndex = {
    backgrounds: {} as Record<string, string>,
    sprites: {} as Record<string, string>,
    cgs: {} as Record<string, string>,
    bgms: {} as Record<string, string>,
    ses: {} as Record<string, string>,
  };
  for (const a of assets) {
    if (a.kind === 'BACKGROUND') assetIndex.backgrounds[a.key] = a.url;
    else if (a.kind === 'SPRITE' || a.kind === 'EXPRESSION') assetIndex.sprites[a.key] = a.url;
    else if (a.kind === 'CG') assetIndex.cgs[a.key] = a.url;
    else if (a.kind === 'BGM') assetIndex.bgms[a.key] = a.url;
    else if (a.kind === 'SE' || a.kind === 'VOICE') assetIndex.ses[a.key] = a.url;
  }

  // 所持プレゼント
  const giftInv = await prisma.playerInventory.findMany({
    where: { userId, itemId: { not: null } },
    include: { item: true },
  });
  const allGifts = await prisma.gameItem.findMany({
    where: {
      isActive: true,
      kind: 'GIFT',
      OR: [{ characterId: scenario.character.id }, { characterId: null }],
    },
    orderBy: [{ sortOrder: 'asc' }, { priceJpy: 'asc' }],
  });
  const ownedMap = new Map(
    giftInv
      .filter((i) => i.item)
      .map((i) => [i.item!.id, i.quantity]),
  );
  const giftItems = allGifts.map((it) => ({
    id: it.id,
    slug: it.slug,
    name: it.name,
    iconUrl: it.iconUrl,
    affinityBoost: it.affinityBoost,
    description: it.description,
    owned: ownedMap.get(it.id) ?? 0,
    priceJpy: it.priceJpy,
    isPremiumOnly: it.isPremiumOnly,
  }));

  // 所持アイテム slug (選択肢制御用)
  const ownedItemSlugs = giftInv
    .filter((i) => i.item && i.quantity > 0)
    .map((i) => i.item!.slug);

  return (
    <GamePlayerClient
      scenarioId={scenario.id}
      characterId={scenario.character.id}
      characterName={scenario.character.name}
      characterSlug={scenario.character.slug}
      characterFallbackSpriteUrl={scenario.character.spriteUrl}
      script={validation.script}
      assetIndex={assetIndex}
      isPremium={isPremium}
      ownedItemSlugs={ownedItemSlugs}
      giftItems={giftItems}
    />
  );
}
