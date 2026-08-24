/**
 * GET /api/media/video-thumbnail/[id]
 *
 * DB (`Video.thumbnailData`) に保存された動画サムネイルを配信する。
 * S3 アセットバケット未設定環境でのフォールバック保存先
 * (site-image / character-image / product-image と同じ構成)。
 *
 * ## 認証を要求しない理由
 *
 * サムネイルは「一覧に並べて会員を誘導する」ためのものなので、
 * 動画本体と違って無料会員・未ログインにも見せる設計になっている
 * (`contents/page.tsx` の listable / playable 分離を参照)。
 * ここで認証を掛けると、無料会員向けの一覧が全部プレースホルダーになり
 * 誘導としての意味を失う。
 *
 * ただし **非公開動画のサムネイルは出さない**。運営が下書き状態で
 * 上げたサムネイルが URL 直打ちで見えてしまうのを防ぐ
 * (id は UUID なので推測は困難だが、下げたつもりのものが見えるのは事故)。
 *
 * 差し替え時は url に ?v=<updatedAt> が付くためブラウザキャッシュは自然に更新される。
 */
import { prisma } from '@idol/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  // id は @db.Uuid なので、UUID 以外が来ると prisma が例外を投げる。
  // 500 ではなく 404 を返したいので事前に弾く。
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return new Response('Not Found', { status: 404 });
  }

  const row = await prisma.videoThumbnail.findUnique({
    where: { videoId: id },
    select: { data: true, contentType: true, video: { select: { isPublished: true } } },
  });

  if (!row || !row.video.isPublished) {
    return new Response('Not Found', { status: 404 });
  }

  const body = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);

  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': row.contentType,
      'Content-Length': String(body.byteLength),
      // url に ?v=<updatedAt> が付くため、内容不変として長期キャッシュしてよい。
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
