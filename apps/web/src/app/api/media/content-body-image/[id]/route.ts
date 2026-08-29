/**
 * GET /api/media/content-body-image/[id]
 *
 * DB に保存されたブログ本文画像を配信する (S3 未設定時のフォールバック保存先)。
 *
 * 認証は不要。理由は、本文画像は記事の一部として `<img src>` で読まれるものであり、
 * 記事自体の公開範囲 (AccessLevel) は記事ページ側で制御されるため。
 * ここで会員判定を挟むと、公開記事の画像が未ログインで表示できなくなる。
 * URL は UUID なので推測による列挙も現実的でない。
 */
import { prisma } from '@idol/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  // 不正な UUID で prisma が例外を投げると 500 になるため、形式を先に確認する。
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return new Response('Not Found', { status: 404 });
  }

  const image = await prisma.contentBodyImage.findUnique({
    where: { id },
    select: { data: true, contentType: true },
  });

  if (!image || !image.data) {
    return new Response('Not Found', { status: 404 });
  }

  const body = Buffer.isBuffer(image.data) ? image.data : Buffer.from(image.data);

  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': image.contentType ?? 'image/jpeg',
      'Content-Length': String(body.byteLength),
      // URL に UUID が入っており内容が変わらないため長期キャッシュしてよい。
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
