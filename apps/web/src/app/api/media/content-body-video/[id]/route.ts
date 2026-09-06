/**
 * GET /api/media/content-body-video/[id]
 *
 * DB に保存されたブログ本文動画を配信する (S3 未設定時のフォールバック保存先)。
 *
 * ## 公開範囲のチェックについて
 *
 * 以前は無認証だった (「記事ページ側で公開範囲を制御しているから不要」という判断)。
 * 画像版と同じ理由でこれを改めている。限定公開の記事に貼った動画クリップが、
 * URL を直接叩けば未ログインでも取得できる状態だったため。
 *
 * 判定は画像と同じ仕組みを共有している (lib/media-access.ts)。
 * 「その動画を参照しているコンテンツのうち最もゆるい公開範囲」を要求水準とするので、
 * 公開記事の動画は従来どおり未ログインでも再生でき、
 * 限定記事の動画はプランを満たさないと 404 になる。
 *
 * ## 画像版と違い Range リクエストに対応している理由
 *
 * 画像は「全部落として表示」で済むが、動画はそうはいかない。
 *
 *   1. iOS Safari は <video> の取得時に必ず `Range: bytes=0-1` を送り、
 *      206 Partial Content と Accept-Ranges/Content-Range が返らないと
 *      再生を諦める。200 で全部返す実装だと **iPhone で再生できない**。
 *   2. シークバーを動かしたときに、その位置のバイトだけを要求してくる。
 *      Range を無視すると毎回先頭から全部を送り直すことになり、
 *      32MB の動画で何度もフル転送が走る。
 *
 * そのため Range ヘッダを解釈して 206 を返す。
 */
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import type { PlanTypeLiteral } from '@idol/shared';
import { parseByteRange } from '@/lib/byte-range';
import { contentBodyVideoMediaPath } from '@/lib/content-body-video';
import { canDeliverMedia, mediaCacheControl, requiredLevelForMedia } from '@/lib/media-access';
import { findMediaReferrers } from '@/lib/media-referrers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  // 不正な UUID で prisma が例外を投げると 500 になるため、形式を先に確認する。
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return new Response('Not Found', { status: 404 });
  }

  const video = await prisma.contentBodyVideo.findUnique({
    where: { id },
    select: { data: true, contentType: true },
  });

  if (!video || !video.data) {
    return new Response('Not Found', { status: 404 });
  }

  // ---- 公開範囲の判定 ----
  const referrers = await findMediaReferrers(contentBodyVideoMediaPath(id));
  const requiredLevel = requiredLevelForMedia(referrers);

  /**
   * PUBLIC 相当なら session を読まない。
   * 動画は Range リクエストで何度も呼ばれるため、
   * 毎回 Cookie を復号すると再生中ずっと余計な処理が走る。
   */
  if (requiredLevel !== 'PUBLIC') {
    const session = await auth();
    const isStaff = session?.user?.role === 'ADMIN' || session?.user?.role === 'SUPER_ADMIN';

    const allowed = canDeliverMedia({
      referrers,
      plan: session?.user?.plan as PlanTypeLiteral | undefined,
      isStaff,
    });

    // 403 だと «その ID の動画は存在する» ことが分かってしまうため 404。
    if (!allowed) {
      return new Response('Not Found', { status: 404 });
    }
  }

  const body = Buffer.isBuffer(video.data) ? video.data : Buffer.from(video.data);
  const size = body.byteLength;
  const contentType = video.contentType ?? 'video/mp4';

  const commonHeaders: Record<string, string> = {
    'Content-Type': contentType,
    // これが無いと iOS Safari が部分取得を諦め、再生できないことがある。
    'Accept-Ranges': 'bytes',
    // 限定公開のものは共有キャッシュに残さない (詳細は lib/media-access.ts)。
    'Cache-Control': mediaCacheControl(requiredLevel),
  };

  const range = parseByteRange(req.headers.get('range'), size);

  if (range) {
    const chunk = body.subarray(range.start, range.end + 1);
    return new Response(chunk as unknown as BodyInit, {
      status: 206,
      headers: {
        ...commonHeaders,
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        'Content-Length': String(chunk.byteLength),
      },
    });
  }

  // Range ヘッダはあるが解釈できなかった場合 (satisfiable でない等) も、
  // 416 を返すより全体を返すほうがブラウザ側の復帰が早い。
  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: { ...commonHeaders, 'Content-Length': String(size) },
  });
}
