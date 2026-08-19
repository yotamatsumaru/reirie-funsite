/**
 * GET /api/game/scenarios/[id]
 *   - シナリオ本体 (script JSON + アセット解決マップ) を返す
 *   - 課金 / プレミアム / 無料トライアル の所有チェックを行う
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { resolveApiSession } from '@/lib/api-auth';
import { validateScenarioScript } from '@idol/shared';
import { errors, handle } from '@/lib/errors';
import { requireGameSectionVisible } from '@/lib/game-visibility';

export const runtime = 'nodejs';

export const GET = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    // ゲーム非公開中は 404 (管理者のみ動作確認のため利用可)。
    await requireGameSectionVisible(req);
    const session = await resolveApiSession(req);
    const userId = session?.user?.id ?? null;
    const isPremium = session?.user?.plan === 'PREMIUM';

    const scenario = await prisma.gameScenario.findUnique({
      where: { id },
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
    if (!scenario || scenario.status !== 'PUBLISHED') {
      throw errors.notFound('シナリオが見つかりません');
    }
    if (scenario.character.status !== 'PUBLISHED') {
      throw errors.notFound('キャラクターが公開されていません');
    }

    // アクセス判定
    let owned = false;
    if (userId) {
      const inv = await prisma.playerInventory.findUnique({
        where: { userId_scenarioId: { userId, scenarioId: scenario.id } },
      });
      owned = !!inv;
    }
    const includedByPremium = scenario.isPremiumIncluded && isPremium;
    const playable = scenario.isFreeTrial || owned || includedByPremium;
    if (!playable) {
      throw errors.forbidden('この章は購入が必要です');
    }
    if (scenario.character.isPremiumOnly && !isPremium) {
      throw errors.planRequired('プレミアム');
    }

    // script 検証 (DB に格納された JSON が壊れていないか)
    const validation = validateScenarioScript(scenario.scriptJson);
    if (!validation.ok) {
      // eslint-disable-next-line no-console
      console.error('[game] scenario script invalid', { id, errors: validation.errors });
      throw errors.internal('シナリオデータが破損しています');
    }

    // 必要アセット
    const assets = await prisma.gameAsset.findMany({
      where: {
        OR: [
          { characterId: scenario.character.id },
          { characterId: null }, // 共通アセット
        ],
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

    // 所持アイテム slug (選択肢制御用)
    let ownedItemSlugs: string[] = [];
    if (userId) {
      const items = await prisma.playerInventory.findMany({
        where: { userId, itemId: { not: null }, quantity: { gt: 0 } },
        include: { item: { select: { slug: true } } },
      });
      ownedItemSlugs = items.map((i) => i.item?.slug).filter((x): x is string => !!x);
    }

    return NextResponse.json({
      scenario: {
        id: scenario.id,
        slug: scenario.slug,
        chapterNumber: scenario.chapterNumber,
        title: scenario.title,
        summary: scenario.summary,
      },
      character: scenario.character,
      script: validation.script,
      assetIndex,
      ownedItemSlugs,
      isPremium,
    });
  },
);
