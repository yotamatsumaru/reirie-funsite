/**
 * GET /api/media/product-image/[id]
 *  - DB に保存された商品画像バイト列を配信する (S3 未設定時のフォールバック保存先).
 *  - 商品画像は公開情報のため認証は不要 (ショップ一覧/詳細でも参照される).
 *  - standalone + PM2 cluster + 再ビルドの影響を受けない単一の真実として DB を用いる。
 */
import { prisma } from '@idol/db';

export const runtime = 'nodejs';
// 画像バイト列は都度 DB から取得する (キャッシュは CDN/ブラウザ側 Cache-Control に任せる)
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  const image = await prisma.productImage.findUnique({
    where: { id },
    select: { data: true, contentType: true },
  });

  if (!image || !image.data) {
    return new Response('Not Found', { status: 404 });
  }

  // Prisma の Bytes は Buffer / Uint8Array
  const body = Buffer.isBuffer(image.data) ? image.data : Buffer.from(image.data);

  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': image.contentType ?? 'application/octet-stream',
      'Content-Length': String(body.byteLength),
      // 画像は不変 (id 単位で 1 枚) なので長期キャッシュ可能
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
