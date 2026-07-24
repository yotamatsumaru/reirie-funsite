/**
 * デジタル特典 (DIGITAL) 配布ファイルの管理 API。
 *
 *  GET    /api/admin/reward-catalog/[id]/assets
 *    - 景品に紐づくファイル一覧 (メタ情報のみ、data は返さない)
 *
 *  POST   /api/admin/reward-catalog/[id]/assets   (multipart/form-data)
 *    - 画像ファイル (file) をアップロード。
 *    - S3 アセットバケット設定時は S3 へ保存し url を記録、
 *      未設定時は DB (data Bytes) に保存する二段構え。
 *    form fields:
 *      file: File (必須, PNG/JPEG/WebP)
 *
 * いずれも MERCH 権限が必要。
 */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { prisma } from '@idol/db';
import {
  REWARD_DIGITAL_ASSET_TYPES,
  MAX_REWARD_DIGITAL_ASSET_BYTES,
  MAX_REWARD_DIGITAL_ASSETS_PER_ITEM,
} from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { isAssetStorageConfigured, putAsset } from '@/lib/s3';

export const runtime = 'nodejs';

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireCapability('MERCH');
  const { id } = await ctx.params;
  const assets = await prisma.rewardDigitalAsset.findMany({
    where: { catalogItemId: id },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      fileName: true,
      contentType: true,
      fileSize: true,
      sortOrder: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ assets });
});

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireCapability('MERCH');
  const { id } = await ctx.params;

  const item = await prisma.rewardCatalogItem.findUnique({
    where: { id },
    select: { id: true, kind: true, _count: { select: { digitalAssets: true } } },
  });
  if (!item) throw errors.notFound();
  if (item.kind !== 'DIGITAL') {
    throw errors.unprocessable('デジタル特典 (DIGITAL) の景品のみファイルを追加できます');
  }
  if (item._count.digitalAssets >= MAX_REWARD_DIGITAL_ASSETS_PER_ITEM) {
    throw errors.unprocessable(
      `1 つの景品に登録できるファイルは ${MAX_REWARD_DIGITAL_ASSETS_PER_ITEM} 件までです`,
    );
  }

  const form = await req.formData().catch(() => null);
  if (!form) throw errors.badRequest('multipart/form-data で送信してください');

  const file = form.get('file');
  if (!(file instanceof File)) throw errors.badRequest('ファイル (file) が必要です');

  const contentType = file.type;
  const ext = REWARD_DIGITAL_ASSET_TYPES[contentType];
  if (!ext) throw errors.badRequest('対応していない形式です (PNG / JPEG / WebP)');
  if (file.size > MAX_REWARD_DIGITAL_ASSET_BYTES) {
    throw errors.badRequest('ファイルサイズは 20MB 以内にしてください');
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const assetId = crypto.randomUUID();
  const fileName = sanitizeFileName(file.name) || `wallpaper-${assetId}.${ext}`;

  // 次の sortOrder
  const max = await prisma.rewardDigitalAsset.aggregate({
    where: { catalogItemId: id },
    _max: { sortOrder: true },
  });
  const sortOrder = (max._max.sortOrder ?? -1) + 1;

  let url: string | null = null;
  let data: Buffer | null = bytes;

  if (isAssetStorageConfigured()) {
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const key = `reward-digital/${yyyy}/${mm}/${assetId}.${ext}`;
    url = await putAsset(key, bytes, contentType);
    data = null; // S3 に置いたので DB には持たない
  }

  const asset = await prisma.rewardDigitalAsset.create({
    data: {
      id: assetId,
      catalogItemId: id,
      fileName,
      contentType,
      fileSize: file.size,
      url,
      data,
      sortOrder,
    },
    select: {
      id: true,
      fileName: true,
      contentType: true,
      fileSize: true,
      sortOrder: true,
      createdAt: true,
    },
  });

  await logAudit({
    userId: session.user.id,
    action: 'reward_catalog.digital_asset_uploaded',
    resource: `reward:${id}/asset:${assetId}`,
    metadata: { contentType, size: file.size, storage: url ? 's3' : 'db' },
  });

  return NextResponse.json({ asset });
});

/** ファイル名から危険な文字を除去し、パス要素を排除する */
function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  return base.replace(/[^\w.\-（）()一-龥ぁ-んァ-ヶ　 ]/g, '').slice(0, 120);
}
