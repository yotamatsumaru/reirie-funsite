/**
 * ギャラリー一覧（ライブ写真などの写真まとめ）
 *
 * ## 位置づけ
 *
 * サイドバーは「コンテンツ」という親項目を廃止し、
 * 種類ごとに独立したメニューを並べる構成にしている (lib/site-nav.ts)。
 * このページはその 3 本目にあたる。
 *
 *   ブログ     (/blog)      … 記事
 *   動画       (/me/videos) … 動画
 *   ギャラリー (/gallery)   … 写真まとめ  ← このページ
 *
 * ## 既存の仕組みを使っている
 *
 * ギャラリー専用のテーブルは作っていない。
 * `Content` の `type = GALLERY` と `content_images` を使う。
 * これらは以前から存在したが表示画面が無く、
 * 「管理画面で種別を選べるのに、選んでも何も起きない」状態だった。
 *
 * ## 表示範囲
 *
 * ContentType.GALLERY のみ、status=PUBLISHED、かつ accessLevel が
 * 自分のプランで見られるものだけ。絞り込み方は /blog と揃えている。
 * contentsVisible が OFF のときは /blog と同様に 404 にする
 * (このトグルは「ブログ・動画」まとめてのマスタースイッチ)。
 *
 * ## 一覧カードでタイル表示にする理由
 *
 * カバー 1 枚を大きく出すだけだと、ブログのカードと見分けがつかず
 * 「複数枚の写真がある」ことが伝わらない。
 * 先頭数枚をタイルで見せ、残り枚数を「+N」で示す。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Images } from 'lucide-react';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import {
  accessLevelLabel,
  accessibleLevels,
  formatJstDate,
  type PlanTypeLiteral,
} from '@idol/shared';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { getSiteSectionVisibility } from '@/lib/app-setting';
import {
  GALLERY_PREVIEW_COUNT,
  galleryPreviewImages,
  remainingImageCount,
  resolveGalleryCover,
} from '@/lib/gallery';

export const metadata: Metadata = { title: 'ギャラリー' };
export const dynamic = 'force-dynamic';

export default async function GalleryListPage() {
  const { contentsVisible } = await getSiteSectionVisibility();
  if (!contentsVisible) notFound();

  const session = await auth();
  const plan = (session?.user?.plan as PlanTypeLiteral | undefined) ?? undefined;

  // 公開範囲の段階を追加したときに列挙を直し忘れると、
  // その段階のコンテンツが誰にも表示されなくなるので共通関数から導出する。
  const allowed = accessibleLevels(plan);

  const galleries = await prisma.content.findMany({
    where: { status: 'PUBLISHED', type: 'GALLERY', accessLevel: { in: allowed } },
    orderBy: { publishedAt: 'desc' },
    take: 48,
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      coverImageUrl: true,
      accessLevel: true,
      publishedAt: true,
      /**
       * タイル表示に使う先頭の数枚だけを取る。
       *
       * take を付けない場合、48 件 × 各 60 枚 = 最大 2880 行を
       * 一覧の描画のためだけに読み込むことになる。
       * 総数は _count で別に数える。
       */
      images: {
        orderBy: { sortOrder: 'asc' },
        take: GALLERY_PREVIEW_COUNT,
        select: { url: true, caption: true },
      },
      _count: { select: { images: true } },
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-800">ギャラリー</h1>
        <Link href="/blog" className="text-sm font-semibold text-brand-600 hover:underline">
          ブログを見る →
        </Link>
      </div>

      {galleries.length === 0 ? (
        <p className="text-sm text-slate-500">公開されているギャラリーはありません</p>
      ) : (
        <div className="grid items-stretch gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {galleries.map((g) => {
            const tiles = galleryPreviewImages(g.images);
            const total = g._count.images;
            const rest = remainingImageCount(total, tiles.length);
            const cover = resolveGalleryCover(g.coverImageUrl, g.images);

            return (
              <Link key={g.id} href={`/contents/${g.slug}`} className="group block h-full">
                <Card className="flex h-full flex-col overflow-hidden transition-shadow group-hover:shadow-md">
                  {/* ===== サムネイル ===== */}
                  {tiles.length === 0 ? (
                    /* 写真 0 枚のギャラリー。カバーだけ設定されている場合もある。 */
                    cover ? (
                      <div className="aspect-video w-full overflow-hidden bg-slate-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={cover}
                          alt={g.title}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="flex aspect-video w-full items-center justify-center bg-gradient-to-br from-brand-100 to-brand-50 text-brand-400">
                        <Images className="h-8 w-8" aria-hidden />
                      </div>
                    )
                  ) : (
                    /*
                      タイル表示。
                      1 枚だけのときは全面、2 枚以上なら 2 列に並べる。
                      «複数枚ある» ことが一覧の時点で伝わるようにする。
                    */
                    <div
                      className={`relative grid aspect-video w-full gap-0.5 bg-slate-100 ${
                        tiles.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                      }`}
                    >
                      {tiles.map((url, i) => (
                        <div
                          key={`${url}-${i}`}
                          className={`overflow-hidden bg-slate-200 ${
                            // 3 枚のときは 1 枚目を縦 2 マス分にして隙間を作らない
                            tiles.length === 3 && i === 0 ? 'row-span-2' : ''
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        </div>
                      ))}

                      {/* 残り枚数。写真が何枚あるかを一覧で示す。 */}
                      {rest !== null && (
                        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-2 py-0.5 text-[11px] font-semibold text-white">
                          +{rest}
                        </span>
                      )}
                    </div>
                  )}

                  <CardBody className="flex flex-1 flex-col">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge tone="gray">
                        <span className="inline-flex items-center gap-1">
                          <Images className="h-3 w-3" aria-hidden />
                          写真 {total} 枚
                        </span>
                      </Badge>
                      {g.accessLevel !== 'PUBLIC' && (
                        <Badge tone={g.accessLevel === 'PREMIUM' ? 'brand' : 'info'}>
                          {accessLevelLabel(g.accessLevel)}
                        </Badge>
                      )}
                    </div>

                    <h2 className="mb-1 line-clamp-2 text-base font-semibold text-slate-800 group-hover:text-brand-700">
                      {g.title}
                    </h2>
                    {g.excerpt && (
                      <p className="line-clamp-2 text-sm text-slate-500">{g.excerpt}</p>
                    )}

                    {/* mt-auto で日付をカード下端に固定し、
                        高さの違うカードが並んでも日付の位置が揃うようにする。 */}
                    <div className="mt-auto">
                      {g.publishedAt && (
                        <p className="mt-2 text-xs text-slate-400">
                          {formatJstDate(g.publishedAt)}
                        </p>
                      )}
                    </div>
                  </CardBody>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
