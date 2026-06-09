/**
 * GET  /api/admin/game/assets?characterId=...
 * POST /api/admin/game/assets
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@idol/db';
import { requireAdmin } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const AssetInputSchema = z.object({
  characterId: z.uuid().nullable().optional(),
  kind: z.enum(['SPRITE', 'EXPRESSION', 'CG', 'BACKGROUND', 'BGM', 'SE', 'VOICE']),
  key: z.string().min(1).max(64),
  url: z.url(),
  alt: z.string().max(120).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  sortOrder: z.number().int().min(0).default(0),
});

export const GET = handle(async (req: Request) => {
  await requireAdmin();
  const url = new URL(req.url);
  const characterId = url.searchParams.get('characterId');
  const kind = url.searchParams.get('kind');
  const items = await prisma.gameAsset.findMany({
    where: {
      ...(characterId !== null ? { characterId: characterId === '' ? null : characterId } : {}),
      ...(kind ? { kind: kind as 'SPRITE' | 'EXPRESSION' | 'CG' | 'BACKGROUND' | 'BGM' | 'SE' | 'VOICE' } : {}),
    },
    orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }],
  });
  return NextResponse.json({ items });
});

export const POST = handle(async (req: Request) => {
  const session = await requireAdmin();
  const body = AssetInputSchema.parse(await req.json());
  // 重複チェック (characterId + kind + key)
  const dup = await prisma.gameAsset.findFirst({
    where: {
      characterId: body.characterId ?? null,
      kind: body.kind,
      key: body.key,
    },
  });
  if (dup) throw errors.conflict('同じキーのアセットが既に存在します');
  const created = await prisma.gameAsset.create({
    data: {
      characterId: body.characterId ?? null,
      kind: body.kind,
      key: body.key,
      url: body.url,
      alt: body.alt,
      metadata: body.metadata as never,
      sortOrder: body.sortOrder,
    },
  });
  await logAudit({ userId: session.user.id, action: 'game.asset.create', resource: created.id });
  return NextResponse.json({ asset: created }, { status: 201 });
});
