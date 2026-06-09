/**
 * GET  /api/game/save-slots?characterId=...   セーブスロット一覧
 * POST /api/game/save-slots                    セーブスロット書込 (upsert)
 *
 * セーブスロット数はプラン別:
 *   FREE=1 / STANDARD=3 / PREMIUM=10
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { SaveSlotInputSchema, SAVE_SLOT_LIMIT } from '@idol/shared';
import { requireSession } from '@/auth';
import { errors, handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const session = await requireSession();
  const userId = session.user.id;
  const plan = session.user.plan;
  const url = new URL(req.url);
  const characterId = url.searchParams.get('characterId');
  if (!characterId) throw errors.badRequest('characterId は必須です');
  const limit = SAVE_SLOT_LIMIT[plan];
  const slots = await prisma.playerSaveSlot.findMany({
    where: { userId, characterId },
    orderBy: { slotIndex: 'asc' },
  });
  return NextResponse.json({ slots, limit, plan });
});

export const POST = handle(async (req: Request) => {
  const session = await requireSession();
  const userId = session.user.id;
  const plan = session.user.plan;
  const body = SaveSlotInputSchema.parse(await req.json());

  const limit = SAVE_SLOT_LIMIT[plan];
  // slotIndex は 0 始まり。プラン別の上限を超えるスロットへの書き込みは拒否
  if (body.slotIndex < 0 || body.slotIndex >= limit) {
    throw errors.forbidden(
      `現在のプラン (${plan}) では ${limit} 個までしかセーブできません。プランをアップグレードすると最大 ${SAVE_SLOT_LIMIT.PREMIUM} 個まで利用できます。`,
    );
  }

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
  return NextResponse.json({ slot: saved, limit, plan });
});
