/**
 * POST /api/game/gift
 *   - 所持アイテム (GameItem.kind=GIFT) を 1 つ消費して
 *     PlayerProgress.affinity に affinityBoost を加算
 *   - 確定報酬: ランダム要素なし (景表法対応)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { GiftUseInputSchema } from '@idol/shared';
import { requireSession } from '@/auth';
import { errors, handle } from '@/lib/errors';

export const runtime = 'nodejs';

export const POST = handle(async (req: Request) => {
  const session = await requireSession();
  const userId = session.user.id;
  const body = GiftUseInputSchema.parse(await req.json());

  const item = await prisma.gameItem.findUnique({ where: { id: body.itemId } });
  if (!item || !item.isActive || item.kind !== 'GIFT') {
    throw errors.notFound('プレゼントが見つかりません');
  }

  const result = await prisma.$transaction(async (tx) => {
    const inv = await tx.playerInventory.findUnique({
      where: { userId_itemId: { userId, itemId: body.itemId } },
    });
    if (!inv || inv.quantity <= 0) {
      throw errors.badRequest('このプレゼントを所持していません');
    }
    const newQty = inv.quantity - 1;
    if (newQty === 0) {
      await tx.playerInventory.delete({ where: { id: inv.id } });
    } else {
      await tx.playerInventory.update({
        where: { id: inv.id },
        data: { quantity: newQty },
      });
    }

    // 親密度加算 (clamp 0-100)
    const progress = await tx.playerProgress.upsert({
      where: { userId_characterId: { userId, characterId: body.characterId } },
      create: {
        userId,
        characterId: body.characterId,
        affinity: Math.max(0, Math.min(100, item.affinityBoost)),
      },
      update: {},
    });
    const newAff = Math.max(0, Math.min(100, progress.affinity + item.affinityBoost));
    const updated = await tx.playerProgress.update({
      where: { id: progress.id },
      data: { affinity: newAff },
    });

    return { progress: updated, remaining: newQty };
  });

  return NextResponse.json({
    affinity: result.progress.affinity,
    remaining: result.remaining,
    affinityBoost: item.affinityBoost,
  });
});
