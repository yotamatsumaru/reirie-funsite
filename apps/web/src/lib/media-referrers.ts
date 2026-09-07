/**
 * 「この配信 URL の画像/動画は、どのコンテンツから参照されているか」を DB から引く。
 *
 * 判定ロジック本体は `media-access.ts` に純粋関数として置いてある。
 * ここは prisma に触る側なので分けている (テスト容易性のため)。
 *
 * ## 参照のされ方が 2 通りある（両方見る必要がある）
 *
 *   1. ギャラリー写真 … `content_images.url` に配信 URL がそのまま入る
 *   2. 本文画像/動画  … `contents.body` の HTML の `<img src>` に埋まっている
 *
 * どちらか一方しか見ないと問題が起きる。
 *
 *   - (1) だけ見ると、PREMIUM 限定ブログの本文画像が «未参照» と判定され
 *     PUBLIC 扱いで配信されてしまう（穴が残る）。
 *   - (2) だけ見ると、ギャラリー写真が «未参照» になる。
 *     これは PUBLIC 扱い = 従来どおり誰でも見られる、つまり今回の穴そのもの。
 *
 * ## body の LIKE 検索について
 *
 * `contents.body` に対する部分一致はインデックスが効かない。
 * それでも採用しているのは、
 *   - contents は記事数のオーダー (数百〜数千) で全文走査でも現実的
 *   - 代わりに「本文画像とコンテンツの対応表」を作る案は、
 *     エディタで画像を消したり貼り直したりするたびに整合を取る必要があり、
 *     ズレたときに «限定記事の画像が公開される» 方向に倒れる
 * という理由。ギャラリー写真側 (件数が多い) は url にインデックスを張ってある。
 *
 * 将来 body が重くなった場合は、参照表を持つのではなく
 * ContentBodyImage に contentId を持たせる方向が素直
 * (ただし «記事作成前にアップロードできる» 仕様を壊さない設計が必要)。
 */
import { prisma } from '@idol/db';
import type { AccessLevelLiteral } from '@idol/shared';
import type { MediaReferrer } from './media-access';

/**
 * 配信 URL (例 `/api/media/content-body-image/<uuid>`) を参照している
 * コンテンツの公開範囲を列挙する。
 *
 * 重複は取り除かない。呼び出し先 (requiredLevelForMedia) は
 * 最もゆるいものを選ぶだけなので重複があっても結果は変わらず、
 * distinct のためのコストをかける意味がない。
 */
export async function findMediaReferrers(mediaPath: string): Promise<MediaReferrer[]> {
  const [galleryRows, bodyRows] = await Promise.all([
    // ギャラリー写真としての参照
    prisma.contentImage.findMany({
      where: { url: mediaPath },
      select: { content: { select: { accessLevel: true } } },
      // 同じ写真が大量のギャラリーに使われていても、
      // 判定に必要なのは «一番ゆるいもの» なので上限を設けて打ち切る。
      // 打ち切りで «よりゆるい» 参照を取りこぼすと厳しい側に倒れるが、
      // その場合に起きるのは «見えるはずの画像が見えない» ではなく
      // 上限 200 件を超える異常な使い回しに限られる。
      take: 200,
    }),
    // 本文 HTML からの参照
    prisma.content.findMany({
      where: { body: { contains: mediaPath } },
      select: { accessLevel: true },
      take: 200,
    }),
  ]);

  const referrers: MediaReferrer[] = [];
  for (const row of galleryRows) {
    referrers.push({ accessLevel: row.content.accessLevel as AccessLevelLiteral });
  }
  for (const row of bodyRows) {
    referrers.push({ accessLevel: row.accessLevel as AccessLevelLiteral });
  }
  return referrers;
}
