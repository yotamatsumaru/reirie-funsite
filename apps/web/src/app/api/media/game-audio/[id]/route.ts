/**
 * GET /api/media/game-audio/[id]
 *  - DB に保存されたゲーム音声バイト列を配信する (S3 未設定時のフォールバック保存先)。
 *  - ゲーム音声は会員向けだが、音声データ自体は秘匿情報ではないため認証は不要。
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

  const audio = await prisma.gameAudio.findUnique({
    where: { id },
    select: { data: true, contentType: true },
  });

  if (!audio || !audio.data) {
    return new Response('Not Found', { status: 404 });
  }

  const body = Buffer.isBuffer(audio.data) ? audio.data : Buffer.from(audio.data);

  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': audio.contentType ?? 'audio/mpeg',
      'Content-Length': String(body.byteLength),
      // url に ?v=<updatedAt> が付くため、内容不変として長期キャッシュしてよい。
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Accept-Ranges': 'bytes',
    },
  });
}
