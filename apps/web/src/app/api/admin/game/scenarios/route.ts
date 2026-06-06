/**
 * GET  /api/admin/game/scenarios?characterId=...   章一覧
 * POST /api/admin/game/scenarios                    章作成 (script 検証込み)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { AdminGameScenarioInputSchema, validateScenarioScript } from '@idol/shared';
import { requireAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  await requireAdmin();
  const url = new URL(req.url);
  const characterId = url.searchParams.get('characterId');
  const items = await prisma.gameScenario.findMany({
    where: characterId ? { characterId } : undefined,
    orderBy: [{ characterId: 'asc' }, { chapterNumber: 'asc' }],
    include: {
      character: { select: { id: true, slug: true, name: true } },
      _count: { select: { inventories: true } },
    },
  });
  return NextResponse.json({ items });
});

export const POST = handle(async (req: Request) => {
  const session = await requireAdmin();
  const body = AdminGameScenarioInputSchema.parse(await req.json());

  const character = await prisma.gameCharacter.findUnique({ where: { id: body.characterId } });
  if (!character) throw errors.badRequest('キャラクターが見つかりません');

  // script 検証
  const v = validateScenarioScript(body.scriptJson);
  if (!v.ok) {
    throw errors.unprocessable('シナリオ JSON が不正です', v.errors);
  }

  // 重複チェック
  const dupChapter = await prisma.gameScenario.findUnique({
    where: { characterId_chapterNumber: { characterId: body.characterId, chapterNumber: body.chapterNumber } },
  });
  if (dupChapter) throw errors.conflict(`第${body.chapterNumber}章は既に存在します`);
  const dupSlug = await prisma.gameScenario.findUnique({
    where: { characterId_slug: { characterId: body.characterId, slug: body.slug } },
  });
  if (dupSlug) throw errors.conflict('同じ slug の章が既に存在します');

  const created = await prisma.gameScenario.create({
    data: {
      ...body,
      scriptJson: v.script as never,
      publishedAt: body.status === 'PUBLISHED' ? new Date() : null,
    },
  });
  await logAudit({
    userId: session.user.id,
    action: 'game.scenario.create',
    resource: created.id,
  });
  return NextResponse.json({ scenario: created }, { status: 201 });
});
