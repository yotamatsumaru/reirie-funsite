/**
 * DELETE /api/admin/reward-catalog/[id]/assets/[assetId]
 *  - デジタル特典の配布ファイルを削除する。
 *  - S3 上の実体は残置し (履歴保全 / コスト微小)、DB レコードのみ削除する。
 *    DB 保存 (data) のものはレコード削除で実体も消える。
 *
 * MERCH 権限が必要。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export const DELETE = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string; assetId: string }> }) => {
    const session = await requireCapability('MERCH');
    const { id, assetId } = await ctx.params;

    const asset = await prisma.rewardDigitalAsset.findUnique({
      where: { id: assetId },
      select: { id: true, catalogItemId: true },
    });
    if (!asset || asset.catalogItemId !== id) throw errors.notFound();

    await prisma.rewardDigitalAsset.delete({ where: { id: assetId } });

    await logAudit({
      userId: session.user.id,
      action: 'reward_catalog.digital_asset_deleted',
      resource: `reward:${id}/asset:${assetId}`,
    });

    return NextResponse.json({ ok: true });
  },
);
