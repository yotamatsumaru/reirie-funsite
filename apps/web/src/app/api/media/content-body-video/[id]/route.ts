/**
 * GET /api/media/content-body-video/[id]
 *
 * DB に保存されたブログ本文動画を配信する (S3 未設定時のフォールバック保存先)。
 *
 * 認証は不要。理由は content-body-image と同じで、本文動画は記事の一部として
 * `<video src>` で読まれるものであり、記事自体の公開範囲 (AccessLevel) は
 * 記事ページ側で制御されるため。ここで会員判定を挟むと、
 * 公開記事の動画が未ログインで再生できなくなる。
 * URL は UUID なので推測による列挙も現実的でない。
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
import { parseByteRange } from '@/lib/byte-range';

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

  const body = Buffer.isBuffer(video.data) ? video.data : Buffer.from(video.data);
  const size = body.byteLength;
  const contentType = video.contentType ?? 'video/mp4';

  const commonHeaders: Record<string, string> = {
    'Content-Type': contentType,
    // これが無いと iOS Safari が部分取得を諦め、再生できないことがある。
    'Accept-Ranges': 'bytes',
    // URL に UUID が入っており内容が変わらないため長期キャッシュしてよい。
    'Cache-Control': 'public, max-age=31536000, immutable',
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
