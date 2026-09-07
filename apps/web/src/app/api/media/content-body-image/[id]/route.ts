/**
 * GET /api/media/content-body-image/[id]
 *
 * DB に保存された本文画像・ギャラリー写真を配信する (S3 未設定時のフォールバック保存先)。
 *
 * ## 以前は無認証だった。なぜ変えたのか（重要）
 *
 * 元の実装にはこう書かれていた:
 *
 *   > 認証は不要。本文画像は記事の一部として <img src> で読まれるものであり、
 *   > 記事自体の公開範囲 (AccessLevel) は記事ページ側で制御されるため。
 *   > URL は UUID なので推測による列挙も現実的でない。
 *
 * ブログ本文の画像だけを配信していた時点では、これは妥当な判断だった。
 * しかしギャラリー機能が同じエンドポイントで写真を配信するようになり、
 * 前提が崩れた。実際に検証したところ:
 *
 *   PREMIUM 限定ギャラリーのページ → 未ログインでは課金案内 (正しい)
 *   その写真の URL を直接叩く      → 未ログインでも 200 で画像が返る (穴)
 *
 * 写真の実体が誰でも取得できる状態では、公開範囲の設定も
 * 画面側のコピー対策も意味を持たない。URL は共有・転載で容易に流通するため、
 * 「UUID だから推測できない」は限定公開の根拠にならない。
 *
 * ## 壊してはいけない性質
 *
 * 会員判定を素朴に足すと、元のコメントが警戒していたとおり
 * **公開記事の画像が未ログインで表示されなくなる**。
 * そこで «画像そのもの» に権限を持たせず、
 * 「その画像を参照しているコンテンツのうち最もゆるい公開範囲」を要求水準とする
 * (詳細は lib/media-access.ts)。これにより
 *
 *   - 公開ブログの本文画像       … 未ログインでも表示される (従来どおり)
 *   - アップロード直後の未参照画像 … 表示される (管理画面のプレビューが壊れない)
 *   - 限定ギャラリーの写真       … プランを満たさないと 404
 *
 * となる。
 *
 * ## 403 ではなく 404 を返す理由
 *
 * 403 は「その ID の画像は存在する」ことを教えてしまう。
 * 限定公開の写真については、存在自体を伏せたほうが情報が漏れない。
 */
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import type { PlanTypeLiteral } from '@idol/shared';
import { contentBodyImageMediaPath } from '@/lib/content-body-image';
import { canDeliverMedia, mediaCacheControl, requiredLevelForMedia } from '@/lib/media-access';
import { findMediaReferrers } from '@/lib/media-referrers';

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

  // ---- 公開範囲の判定 ----
  const referrers = await findMediaReferrers(contentBodyImageMediaPath(id));
  const requiredLevel = requiredLevelForMedia(referrers);

  /**
   * PUBLIC 相当の画像ではセッションを読まない。
   *
   * auth() は毎リクエストで Cookie 復号を行うため、
   * 記事 1 本に画像が 20 枚あると 20 回走ることになる。
   * 公開画像は判定結果が session に依らないので、先に短絡する。
   */
  if (requiredLevel !== 'PUBLIC') {
    const session = await auth();
    const isStaff =
      session?.user?.role === 'ADMIN' || session?.user?.role === 'SUPER_ADMIN';

    const allowed = canDeliverMedia({
      referrers,
      plan: session?.user?.plan as PlanTypeLiteral | undefined,
      isStaff,
    });

    if (!allowed) {
      return new Response('Not Found', { status: 404 });
    }
  }

  const body = Buffer.isBuffer(image.data) ? image.data : Buffer.from(image.data);

  return new Response(body as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': image.contentType ?? 'image/jpeg',
      'Content-Length': String(body.byteLength),
      /**
       * 限定公開の画像は共有キャッシュに残さない。
       * public, immutable のままだと CDN やプロキシに実体が載り、
       * ここでの判定を通らずに第三者へ配信され得る。
       */
      'Cache-Control': mediaCacheControl(requiredLevel),
    },
  });
}
