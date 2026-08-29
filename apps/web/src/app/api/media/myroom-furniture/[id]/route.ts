/**
 * GET /api/media/myroom-furniture/[id]
 *  - DB に保存された家具画像のバイト列を配信する (S3 未設定時のフォールバック)。
 *  - standalone + PM2 cluster + 再ビルドの影響を受けない単一の真実として DB を使う。
 *
 * 【認証をかけていない理由】
 * 家具画像は「どんな家具が売っているか」という公開情報であり、URL は
 * ランダムな UUID なので推測もできない。ここに認証をかけると、将来
 * 会員向けショップ (PR2) で画像を表示するたびにセッション判定が走り、
 * キャッシュも効かなくなる。
 *
 * ただし「準備中 (DRAFT) の家具の画像」も URL を知っていれば見えることになる。
 * 家具画像に秘匿性のある情報を載せない運用を前提とする
 * (SiteImage / ProductImage と同じ扱い)。
 */
import { prisma } from '@idol/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  // UUID 以外で DB を叩かない (不正な id で Prisma が例外を投げるのを防ぐ)。
  if (!UUID_RE.test(id)) return new Response('Not Found', { status: 404 });

  const furniture = await prisma.myRoomFurniture.findUnique({
    where: { id },
    select: { data: true, contentType: true },
  });

  if (!furniture || !furniture.data) {
    return new Response('Not Found', { status: 404 });
  }

  const body = Buffer.isBuffer(furniture.data)
    ? furniture.data
    : Buffer.from(furniture.data);

  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': furniture.contentType ?? 'image/png',
      'Content-Length': String(body.byteLength),
      // 画像を差し替えると url に ?v=<timestamp> が付き直るため、
      // 内容不変として長期キャッシュしてよい。
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
