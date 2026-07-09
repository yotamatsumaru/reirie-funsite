/**
 * GET /api/media/character-image/[id]
 *  - DB に保存されたキャラクター画像バイト列を配信する (S3 未設定時のフォールバック保存先)。
 *  - あっち向いてホイのキャラクター画像はゲーム画面の表示用であり公開情報のため認証は不要。
 *  - standalone + PM2 cluster + 再ビルドの影響を受けない単一の真実として DB を用いる。
 *  - 差し替え時は url に ?v=<updatedAt> が付くためブラウザキャッシュは自然に更新される。
 */
import { prisma } from '@idol/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  const image = await prisma.characterImage.findUnique({
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
      'Content-Type': image.contentType ?? 'image/png',
      'Content-Length': String(body.byteLength),
      // url に ?v=<updatedAt> が付くため、内容不変として長期キャッシュしてよい。
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
