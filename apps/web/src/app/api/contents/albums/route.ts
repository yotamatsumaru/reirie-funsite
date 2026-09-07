/**
 * GET /api/contents/albums?type=GALLERY
 *
 * アルバムタブ用の一覧 (名前・絞り込みキー・件数) を返す。
 *
 * ## なぜ /api/contents とは別のエンドポイントにしたのか
 *
 * アルバムのタブは «絞り込み前の全件» から組み立てる必要がある
 * (Web版 /gallery ページの albumRows クエリと同じ理由)。
 * タブを「今表示中のアルバムだけ」から作ると、絞り込んだ瞬間に
 * 他のタブが消えて戻れなくなる。
 *
 * これを /api/contents の1レスポンスに同居させると、
 * ページネーションされた `items` とは無関係な「全アルバム一覧」が
 * 毎回のリクエストに乗ることになり、ページを進めるたびに
 * 同じ集計を繰り返すだけの無駄なクエリになる。
 * クライアント側でも「タブは初回だけ取得し、一覧は絞り込みごとに再取得する」
 * という自然な呼び分けができなくなる。
 *
 * ## 件数に閲覧不可のアイテムも含める
 *
 * /api/contents (type=GALLERY) がアイテムを除外しない (鍵付きで見せる) のと
 * 同じ理由で、タブの件数もユーザーのプランによって変わらないようにする。
 * 内訳がプランごとに違うと、運営が自分の画面と会員の画面の差に気付きにくい。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@idol/db';
import { publishedContentWhere } from '@/lib/content-visibility';
import { ContentTypeSchema } from '@idol/shared';
import { handle, errors } from '@/lib/errors';
import { getSiteSectionVisibility } from '@/lib/app-setting';
import { groupByAlbum } from '@/lib/gallery-album';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const { contentsVisible } = await getSiteSectionVisibility();
  if (!contentsVisible) throw errors.notFound('コンテンツは現在非公開です');

  const url = new URL(req.url);
  const type = ContentTypeSchema.parse(url.searchParams.get('type') ?? 'GALLERY');

  const rows = await prisma.content.findMany({
    where: { ...publishedContentWhere(), type },
    orderBy: { publishedAt: 'desc' },
    select: { album: true },
  });

  const groups = groupByAlbum(rows).map((g) => ({
    name: g.name,
    key: g.key,
    count: g.items.length,
  }));

  return NextResponse.json({ albums: groups });
});
