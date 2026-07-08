/**
 * GET  /api/game/progress?characterId=...   自分の進捗
 * POST /api/game/progress                    進捗を保存 (upsert)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { SaveProgressInputSchema } from '@idol/shared';
import { requireApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const userId = session.user.id;
  const url = new URL(req.url);
  const characterId = url.searchParams.get('characterId');
  if (!characterId) throw errors.badRequest('characterId は必須です');
  const p = await prisma.playerProgress.findUnique({
    where: { userId_characterId: { userId, characterId } },
  });
  return NextResponse.json({ progress: p });
});

export const POST = handle(async (req: Request) => {
  const session = await requireApiSession(req);
  const userId = session.user.id;
  const body = SaveProgressInputSchema.parse(await req.json());

  // characterId 検証
  const character = await prisma.gameCharacter.findUnique({
    where: { id: body.characterId },
    select: { id: true, status: true },
  });
  if (!character || character.status !== 'PUBLISHED') {
    throw errors.notFound('キャラクターが見つかりません');
  }

  const existing = await prisma.playerProgress.findUnique({
    where: { userId_characterId: { userId, characterId: body.characterId } },
  });

  const playMinutesDelta = body.playMinutesDelta ?? 0;
  const merged = existing
    ? {
        affinity: body.affinity ?? existing.affinity,
        routeResult: (body.routeResult ?? existing.routeResult) as
          | 'IN_PROGRESS'
          | 'FRIEND_END'
          | 'LOVE_END'
          | 'SPECIAL_END'
          | 'BAD_END',
        flagsJson: body.flags ?? (existing.flagsJson as object),
        lastScenarioId: body.scenarioId ?? existing.lastScenarioId,
        lastSceneKey: body.sceneKey ?? existing.lastSceneKey,
        totalPlayMinutes: existing.totalPlayMinutes + playMinutesDelta,
      }
    : {
        affinity: body.affinity ?? 0,
        routeResult: (body.routeResult ?? 'IN_PROGRESS') as
          | 'IN_PROGRESS'
          | 'FRIEND_END'
          | 'LOVE_END'
          | 'SPECIAL_END'
          | 'BAD_END',
        flagsJson: body.flags ?? {},
        lastScenarioId: body.scenarioId,
        lastSceneKey: body.sceneKey,
        totalPlayMinutes: playMinutesDelta,
      };

  const saved = await prisma.playerProgress.upsert({
    where: { userId_characterId: { userId, characterId: body.characterId } },
    create: {
      userId,
      characterId: body.characterId,
      ...merged,
      flagsJson: merged.flagsJson as never,
    },
    update: {
      ...merged,
      flagsJson: merged.flagsJson as never,
    },
  });

  return NextResponse.json({ progress: saved });
});
