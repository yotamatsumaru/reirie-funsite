/**
 * PATCH /api/admin/reward-redemptions/[id] — 発送管理ステータス更新
 *   PENDING → PROCESSING → SHIPPED → COMPLETED
 *   PENDING/PROCESSING → CANCELED (特典ポイント返還・在庫復元)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { AdminUpdateRedemptionStatusSchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { updateRedemptionStatus } from '@/lib/points';

export const runtime = 'nodejs';

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireCapability('MERCH');
  const { id } = await ctx.params;
  const redemption = await prisma.rewardRedemption.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, email: true, displayName: true, memberNumber: true } },
      catalogItem: { select: { id: true, slug: true, name: true, kind: true } },
    },
  });
  if (!redemption) throw errors.notFound();
  return NextResponse.json({ redemption });
});

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('MERCH');
    const { id } = await ctx.params;
    const body = AdminUpdateRedemptionStatusSchema.parse(await req.json());

    const existing = await prisma.rewardRedemption.findUnique({ where: { id } });
    if (!existing) throw errors.notFound();

    // 同一ステータスの場合は追跡番号・運営メモのみを更新する (ワークフロー遷移とは別扱い)
    if (existing.status === body.status) {
      const redemption = await prisma.rewardRedemption.update({
        where: { id },
        data: {
          trackingNumber: body.trackingNumber ?? existing.trackingNumber,
          adminNote: body.adminNote ?? existing.adminNote,
        },
      });
      await logAudit({
        userId: session.user.id,
        action: 'reward_redemption.note_update',
        resource: id,
      });
      return NextResponse.json({ redemption });
    }

    const result = await updateRedemptionStatus(id, body.status, {
      trackingNumber: body.trackingNumber,
      adminNote: body.adminNote,
    });

    if (!result.ok) {
      if (result.reason === 'NOT_FOUND') throw errors.notFound();
      throw errors.conflict('このステータスには遷移できません');
    }

    await logAudit({
      userId: session.user.id,
      action: 'reward_redemption.status_update',
      resource: id,
      metadata: { status: body.status, trackingNumber: body.trackingNumber ?? null },
    });

    const redemption = await prisma.rewardRedemption.findUnique({ where: { id } });
    return NextResponse.json({ redemption });
  },
);
