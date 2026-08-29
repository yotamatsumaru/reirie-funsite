/**
 * POST /api/admin/myroom/furnitures/[id]/image — 家具画像のアップロード / 差し替え
 *
 * multipart/form-data の `file` を受け取る。
 *
 * 【なぜ既存の /api/admin/uploads/image を使わないか】
 * あの endpoint は MERCH 権限を要求し、さらに S3 未設定だとエラーになる。
 * 家具は CONTENT 権限の管理者が扱うもので、S3 未設定のローカル / 小規模環境でも
 * 動く必要があるため、DB フォールバックを持つ専用の経路にしている。
 * (ブログ本文画像で同じ問題に当たったときと同じ判断)
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { validateMyRoomFurnitureImage } from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { saveMyRoomFurnitureImage } from '@/lib/myroom-furniture-image';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireCapability('CONTENT');
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) throw errors.notFound('家具が見つかりません');

  const existing = await prisma.myRoomFurniture.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!existing) throw errors.notFound('家具が見つかりません');

  const form = await req.formData().catch(() => null);
  if (!form) throw errors.badRequest('画像の送信形式が不正です');

  const file = form.get('file');
  if (!(file instanceof File)) throw errors.badRequest('画像ファイルが含まれていません');

  const validation = validateMyRoomFurnitureImage({
    contentType: file.type,
    sizeBytes: file.size,
  });
  if (!validation.ok) throw errors.badRequest(validation.message);

  const bytes = Buffer.from(await file.arrayBuffer());
  // File.size は信頼せず、実際に読み込んだバイト数でもう一度確認する
  // (size を偽装したリクエストで上限をすり抜けられないように)。
  const recheck = validateMyRoomFurnitureImage({
    contentType: file.type,
    sizeBytes: bytes.byteLength,
  });
  if (!recheck.ok) throw errors.badRequest(recheck.message);

  const stored = await saveMyRoomFurnitureImage({
    furnitureId: id,
    bytes,
    contentType: file.type,
    ext: validation.ext,
    fileName: file.name || null,
  });

  await logAudit({
    userId: session.user.id,
    action: 'admin.myroom.furniture_image_uploaded',
    resource: `myroom-furniture:${id}`,
    metadata: {
      storage: stored.storage,
      sizeBytes: bytes.byteLength,
      contentType: file.type,
    },
  });

  return NextResponse.json({ imageUrl: stored.url, storage: stored.storage });
});
