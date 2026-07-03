/**
 * GET  /api/me/reward-redemptions — 自分の景品交換履歴
 * POST /api/me/reward-redemptions — 景品交換申請 (特典ポイント消費)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { RedeemRewardCatalogItemInputSchema } from '@idol/shared';
import { requireSession } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { redeemRewardCatalogItem } from '@/lib/points';

export const runtime = 'nodejs';

const REDEEM_ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: '景品が見つかりません',
  NOT_AVAILABLE: 'この景品は現在交換できません',
  OUT_OF_STOCK: '在庫切れです',
  SHIPPING_REQUIRED: '発送先情報を入力してください',
};

export const GET = handle(async () => {
  const session = await requireSession();
  const redemptions = await prisma.rewardRedemption.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return NextResponse.json({ redemptions });
});

export const POST = handle(async (req: Request) => {
  const session = await requireSession();
  const body = RedeemRewardCatalogItemInputSchema.parse(await req.json());

  const result = await redeemRewardCatalogItem(session.user.id, body.catalogItemId, {
    shippingName: body.shippingName,
    shippingPhone: body.shippingPhone,
    shippingPostalCode: body.shippingPostalCode,
    shippingPrefecture: body.shippingPrefecture,
    shippingAddress1: body.shippingAddress1,
    shippingAddress2: body.shippingAddress2,
  });

  if (!result.ok) {
    throw errors.conflict(REDEEM_ERROR_MESSAGES[result.reason] ?? '交換できません');
  }

  await logAudit({
    userId: session.user.id,
    action: 'reward_redemption.create',
    resource: result.redemptionId,
    metadata: { catalogItemId: body.catalogItemId },
  });

  return NextResponse.json(
    { redemptionId: result.redemptionId, balance: result.balance },
    { status: 201 },
  );
});
