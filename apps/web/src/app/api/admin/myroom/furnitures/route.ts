/**
 * GET  /api/admin/myroom/furnitures — 家具マスタ一覧
 * POST /api/admin/myroom/furnitures — 家具マスタ新規作成
 *
 * 【権限について】CONTENT 権限を要求する。
 * MyRoom の家具はサイトに掲載する素材（画像・名前・説明）であり、
 * コンテンツ管理と同じ性質のため。MERCH（物販）ではないのは、
 * Pui で交換するデジタル要素であって実物の在庫・発送を伴わないから。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { MyRoomFurnitureInputSchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/** 一覧・詳細で返すフィールド。data (画像バイト列) は絶対に含めない。 */
const FURNITURE_SELECT = {
  id: true,
  name: true,
  description: true,
  category: true,
  status: true,
  puiCost: true,
  widthCells: true,
  heightCells: true,
  sortOrder: true,
  imageUrl: true,
  contentType: true,
  fileName: true,
  sizeBytes: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const GET = handle(async () => {
  await requireCapability('CONTENT');
  const furnitures = await prisma.myRoomFurniture.findMany({
    // 準備中を先に出す。運営が「まだ作業が残っている家具」を
    // 見落とさないようにするため。
    orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
    select: FURNITURE_SELECT,
  });
  return NextResponse.json({ furnitures });
});

export const POST = handle(async (req: Request) => {
  const session = await requireCapability('CONTENT');
  const input = MyRoomFurnitureInputSchema.parse(await req.json());

  const created = await prisma.myRoomFurniture.create({
    data: {
      name: input.name,
      description: input.description,
      category: input.category,
      status: input.status,
      puiCost: input.puiCost,
      widthCells: input.widthCells,
      heightCells: input.heightCells,
      sortOrder: input.sortOrder,
      createdById: session.user.id,
    },
    select: FURNITURE_SELECT,
  });

  await logAudit({
    userId: session.user.id,
    action: 'admin.myroom.furniture_created',
    resource: `myroom-furniture:${created.id}`,
    metadata: { name: created.name, status: created.status, puiCost: created.puiCost },
  });

  return NextResponse.json({ furniture: created }, { status: 201 });
});
