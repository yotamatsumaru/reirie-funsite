/**
 * GET /api/game/characters/[slug]
 *   - キャラ詳細 + 章一覧 + 自分の進捗 + 自分の所持アイテム
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { errors, handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(
  async (_req: Request, ctx: { params: Promise<{ slug: string }> }) => {
    const { slug } = await ctx.params;
    const session = await auth();
    const userId = session?.user?.id ?? null;
    const isPremium = session?.user?.plan === 'PREMIUM';

    const character = await prisma.gameCharacter.findUnique({
      where: { slug },
      include: {
        scenarios: {
          where: { status: 'PUBLISHED' },
          orderBy: { chapterNumber: 'asc' },
          select: {
            id: true,
            slug: true,
            chapterNumber: true,
            title: true,
            summary: true,
            priceJpy: true,
            isFreeTrial: true,
            isPremiumIncluded: true,
            requiredAffinity: true,
            estimatedMinutes: true,
          },
        },
      },
    });
    if (!character || character.status !== 'PUBLISHED') {
      throw errors.notFound('キャラクターが見つかりません');
    }
    if (character.isPremiumOnly && !isPremium) {
      throw errors.planRequired('プレミアム');
    }

    let progress: { affinity: number; routeResult: string; flagsJson: unknown } | null = null;
    let ownedScenarioIds = new Set<string>();
    let ownedItemSlugs: string[] = [];
    if (userId) {
      const [p, inv, items] = await Promise.all([
        prisma.playerProgress.findUnique({
          where: { userId_characterId: { userId, characterId: character.id } },
        }),
        prisma.playerInventory.findMany({
          where: { userId, scenarioId: { not: null } },
          select: { scenarioId: true },
        }),
        prisma.playerInventory.findMany({
          where: { userId, itemId: { not: null }, quantity: { gt: 0 } },
          include: { item: { select: { slug: true } } },
        }),
      ]);
      progress = p
        ? { affinity: p.affinity, routeResult: p.routeResult, flagsJson: p.flagsJson }
        : null;
      ownedScenarioIds = new Set(inv.map((i) => i.scenarioId).filter((x): x is string => !!x));
      ownedItemSlugs = items.map((i) => i.item?.slug).filter((x): x is string => !!x);
    }

    const scenarios = character.scenarios.map((s) => {
      const owned = ownedScenarioIds.has(s.id);
      const includedByPremium = s.isPremiumIncluded && isPremium;
      const playable = s.isFreeTrial || owned || includedByPremium;
      return {
        ...s,
        owned,
        includedByPremium,
        playable,
      };
    });

    return NextResponse.json({
      character: {
        id: character.id,
        slug: character.slug,
        name: character.name,
        furigana: character.furigana,
        catchcopy: character.catchcopy,
        description: character.description,
        age: character.age,
        birthday: character.birthday,
        bloodType: character.bloodType,
        height: character.height,
        portraitUrl: character.portraitUrl,
        spriteUrl: character.spriteUrl,
        themeColor: character.themeColor,
        affinityMax: character.affinityMax,
      },
      scenarios,
      progress,
      ownedItemSlugs,
    });
  },
);
