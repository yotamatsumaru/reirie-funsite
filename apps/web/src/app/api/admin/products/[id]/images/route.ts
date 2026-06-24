/**
 * GET   /api/admin/products/[id]/images - 商品画像一覧
 * POST  /api/admin/products/[id]/images - 画像URLを追加（末尾に追加）
 * PATCH /api/admin/products/[id]/images - 画像の表示順を並べ替え
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { AddProductImageSchema, ReorderProductImagesSchema } from '@idol/shared';
import { requireCapability } from '@/auth';
import { errors, handle } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  createProductImageFromBytes,
} from '@/lib/product-image';

export const runtime = 'nodejs';

export const GET = handle(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    await requireCapability('MERCH');
    const { id } = await ctx.params;
    const images = await prisma.productImage.findMany({
      where: { productId: id },
      orderBy: { sortOrder: 'asc' },
    });
    return NextResponse.json({ items: images });
  },
);

export const POST = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('MERCH');
    const { id } = await ctx.params;

    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) throw errors.notFound('商品が見つかりません');

    const last = await prisma.productImage.findFirst({
      where: { productId: id },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const nextOrder = (last?.sortOrder ?? -1) + 1;

    const contentTypeHeader = req.headers.get('content-type') ?? '';

    // ---- (A) multipart/form-data: ファイルを直接アップロード ----
    if (contentTypeHeader.includes('multipart/form-data')) {
      const form = await req.formData().catch(() => null);
      if (!form) throw errors.badRequest('multipart/form-data の解析に失敗しました');

      const file = form.get('file');
      if (!(file instanceof File)) throw errors.badRequest('画像ファイル (file) が必要です');

      const ext = ALLOWED_IMAGE_TYPES[file.type];
      if (!ext) {
        throw errors.badRequest('対応していない画像形式です (JPEG/PNG/WebP/GIF/AVIF)');
      }
      if (file.size > MAX_IMAGE_BYTES) {
        throw errors.badRequest('画像サイズは 8MB 以内にしてください');
      }

      const altRaw = form.get('alt');
      const alt = typeof altRaw === 'string' && altRaw.trim() !== '' ? altRaw.trim() : null;
      const bytes = Buffer.from(await file.arrayBuffer());

      const stored = await createProductImageFromBytes({
        productId: id,
        bytes,
        contentType: file.type,
        ext,
        alt,
        sortOrder: nextOrder,
      });

      await logAudit({
        userId: session.user.id,
        action: 'admin.product.image_added',
        resource: `product:${id}`,
        metadata: { imageId: stored.id, storage: stored.storage, size: file.size },
      });

      return NextResponse.json(
        { id: stored.id, url: stored.url, sortOrder: nextOrder },
        { status: 201 },
      );
    }

    // ---- (B) application/json: URL を直接登録 (外部URL / seed 互換) ----
    const body = AddProductImageSchema.parse(await req.json());
    const created = await prisma.productImage.create({
      data: {
        productId: id,
        url: body.url,
        alt: body.alt ?? null,
        sortOrder: nextOrder,
      },
    });

    await logAudit({
      userId: session.user.id,
      action: 'admin.product.image_added',
      resource: `product:${id}`,
      metadata: { imageId: created.id, storage: 'url' },
    });

    return NextResponse.json(created, { status: 201 });
  },
);

export const PATCH = handle(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const session = await requireCapability('MERCH');
    const { id } = await ctx.params;
    const body = ReorderProductImagesSchema.parse(await req.json());

    const images = await prisma.productImage.findMany({
      where: { productId: id },
      select: { id: true },
    });
    const valid = new Set(images.map((i) => i.id));
    if (body.order.some((imgId) => !valid.has(imgId))) {
      throw errors.badRequest('この商品に属さない画像が含まれています');
    }

    await prisma.$transaction(
      body.order.map((imgId, idx) =>
        prisma.productImage.update({
          where: { id: imgId },
          data: { sortOrder: idx },
        }),
      ),
    );

    await logAudit({
      userId: session.user.id,
      action: 'admin.product.images_reordered',
      resource: `product:${id}`,
      metadata: { order: body.order },
    });

    const updated = await prisma.productImage.findMany({
      where: { productId: id },
      orderBy: { sortOrder: 'asc' },
    });
    return NextResponse.json({ items: updated });
  },
);
