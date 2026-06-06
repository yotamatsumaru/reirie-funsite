/**
 * GET  /api/game/save-slots?characterId=...   セーブスロット一覧 (5枠)
 * POST /api/game/save-slots                    セーブスロット書込 (upsert)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { SaveSlotInputSchema } from '@idol/shared';
import { requireSession } from '@/auth';
import { errors, handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const session = await requireSession();
  const userId = session.user.id;
  const url = new URL(req.url);
  const characterId = url.searchParams.get('characterId');
  if (!characterId) throw errors.badRequest('characterId は必須です');
  const slots = await prisma.playerSaveSlot.findMany({
    where: { userId, characterId },
    orderBy: { slotIndex: 'asc' },
  });
  return NextResponse.json({ slots });
});

export const POST = handle(async (req: Request) => {
  const session = await requireSession();
  const userId = session.user.id;
  const body = SaveSlotInputSchema.parse(await req.json());

  const saved = await prisma.playerSaveSlot.upsert({
    where: {
      userId_characterId_slotIndex: {
        userId,
        characterId: body.characterId,
        slotIndex: body.slotIndex,
      },
    },
    create: {
      userId,
      characterId: body.characterId,
      slotIndex: body.slotIndex,
      label: body.label,
      snapshotJson: body.snapshot as never,
    },
    update: {
      label: body.label,
      snapshotJson: body.snapshot as never,
      savedAt: new Date(),
    },
  });
  return NextResponse.json({ slot: saved });
});
