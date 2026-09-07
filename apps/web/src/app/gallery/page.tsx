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
 *
 * ## アルバム分け
 *
 * `Content.album` (任意の文字列) でまとめる。
 * 絞り込みは `?album=<名前>`、アルバム未設定のものは `?album=__none__`。
 * 判定・グルーピングのロジックは lib/gallery-album.ts にある
 * (専用テーブルを作らなかった理由もそちらに記載)。
 *
 * ## 公開範囲の扱い — 「隠す」ではなく「鍵付きで見せる」
 *
 * ブログ (/blog) は見られないものを一覧から除外している。
 * ギャラリーでは **除外せず、鍵付きのカードとして表示** する。理由は 2 つ:
 *
 *   1. 「プレミアムだとどんな写真があるのか」が全く分からないと、
 *      プラン加入の判断材料が無い。件数と «限定» の表示だけでも意味がある。
 *   2. アルバムのタブを «見られるものだけ» で組み立てると、
 *      アルバムごと消えてタブの並びが人によって変わり、
 *      運営が «自分の画面と会員の画面が違う» ことに気付きにくい。
 *
 * ただし鍵付きカードでは **サムネイルを一切出さない**。
 * 出そうとしても画像配信側の公開範囲チェックで 404 になり
 * 「壊れた画像アイコン」が並ぶだけになるため
 * (詳細は lib/media-access.ts)。代わりに鍵のプレースホルダを置く。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Images, Lock } from 'lucide-react';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import {
  accessLevelLabel,
  canAccess,
  formatJstDate,
  type AccessLevelLiteral,
  type PlanTypeLiteral,
} from '@idol/shared';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { getSiteSectionVisibility } from '@/lib/app-setting';
import { publishedContentWhere } from '@/lib/content-visibility';
import {
  GALLERY_PREVIEW_COUNT,
  galleryPreviewImages,
  remainingImageCount,
  resolveGalleryCover,
} from '@/lib/gallery';
import { albumFilterWhere, groupByAlbum, isSelectedAlbum } from '@/lib/gallery-album';

export const metadata: Metadata = { title: 'ギャラリー' };
export const dynamic = 'force-dynamic';

export default async function GalleryListPage({
  searchParams,
}: {
  searchParams: Promise<{ album?: string }>;
}) {
  const { contentsVisible } = await getSiteSectionVisibility();
  if (!contentsVisible) notFound();

  const { album: selectedAlbum } = await searchParams;

  const session = await auth();
  const plan = (session?.user?.plan as PlanTypeLiteral | undefined) ?? undefined;

  /**
   * タブの組み立てには «絞り込み前» の全件が必要なので、
   * アルバム一覧用のクエリと表示用のクエリを分ける。
   *
   * タブを表示中のアルバムだけから作ると、
   * 絞り込んだ瞬間に他のタブが消えて戻れなくなる。
   */
  const albumRows = await prisma.content.findMany({
    where: { ...publishedContentWhere(), type: 'GALLERY' },
    orderBy: { publishedAt: 'desc' },
    select: { album: true },
  });
  const albumGroups = groupByAlbum(albumRows);

  const galleries = await prisma.content.findMany({
    where: {
      // 公開予約を尊重する (詳細は lib/content-visibility.ts)。
      ...publishedContentWhere(),
      type: 'GALLERY',
      // 公開範囲での除外はしない (上のコメント参照)。
      // 代わりに描画時に鍵付きカードにする。
      ...albumFilterWhere(selectedAlbum),
    },
    orderBy: { publishedAt: 'desc' },
    take: 48,
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      coverImageUrl: true,
      accessLevel: true,
      album: true,
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-800">ギャラリー</h1>
        <Link href="/blog" className="text-sm font-semibold text-brand-600 hover:underline">
          ブログを見る →
        </Link>
      </div>

      {/*
        ===== アルバムのタブ =====
        アルバムが 1 つも設定されていない (= 全部「その他」) 状態では
        タブを出さない。「その他」だけのタブは情報量が無く、
        押しても何も変わらないので混乱を招く。
      */}
      {albumGroups.length > 1 && (
        <nav aria-label="アルバム" className="mb-6 flex flex-wrap gap-2">
          <AlbumTab href="/gallery" label="すべて" active={!selectedAlbum?.trim()} />
          {albumGroups.map((group) => (
            <AlbumTab
              key={group.key}
              href={`/gallery?album=${encodeURIComponent(group.key)}`}
              label={group.name}
              count={group.items.length}
              active={isSelectedAlbum(selectedAlbum, group.key)}
            />
          ))}
        </nav>
      )}

      {galleries.length === 0 ? (
        <p className="text-sm text-slate-500">
          {selectedAlbum?.trim()
            ? 'このアルバムに公開されているギャラリーはありません'
            : '公開されているギャラリーはありません'}
        </p>
      ) : (
        <div className="grid items-stretch gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {galleries.map((g) => {
            const accessLevel = g.accessLevel as AccessLevelLiteral;
            const unlocked = canAccess(plan, accessLevel);
            const tiles = unlocked ? galleryPreviewImages(g.images) : [];
            const total = g._count.images;
            const rest = remainingImageCount(total, tiles.length);
            const cover = unlocked ? resolveGalleryCover(g.coverImageUrl, g.images) : null;

            return (
              <Link key={g.id} href={`/contents/${g.slug}`} className="group block h-full">
                <Card className="flex h-full flex-col overflow-hidden transition-shadow group-hover:shadow-md">
                  {/* ===== サムネイル ===== */}
                  {!unlocked ? (
                    /*
                      見られないギャラリー。写真は一切出さない。
                      出そうとしても配信側で 404 になり «壊れた画像» が並ぶだけ。
                    */
                    <div className="flex aspect-video w-full flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-slate-200 to-slate-100 text-slate-400">
                      <Lock className="h-7 w-7" aria-hidden />
                      <span className="text-xs font-semibold">
                        {accessLevelLabel(accessLevel)}
                      </span>
                    </div>
                  ) : tiles.length === 0 ? (
                    /* 写真 0 枚のギャラリー。カバーだけ設定されている場合もある。 */
                    cover ? (
                      <div className="aspect-video w-full overflow-hidden bg-slate-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={cover}
                          alt={g.title}
                          loading="lazy"
                          draggable={false}
                          className="h-full w-full select-none object-cover"
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
                      className={`relative grid aspect-video w-full select-none gap-0.5 bg-slate-100 ${
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
                            // 一覧のサムネイルもドラッグで抜き出せないようにする
                            // (詳細な方針は components/gallery/GalleryGrid.tsx)。
                            draggable={false}
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
                      {accessLevel !== 'PUBLIC' && (
                        <Badge tone={accessLevel === 'PREMIUM' ? 'brand' : 'info'}>
                          <span className="inline-flex items-center gap-1">
                            {!unlocked && <Lock className="h-3 w-3" aria-hidden />}
                            {accessLevelLabel(accessLevel)}
                          </span>
                        </Badge>
                      )}
                      {/*
                        絞り込んでいないときだけアルバム名を出す。
                        絞り込み中は全カードが同じ値になり、
                        すでにタブで示されているので情報の重複になる。
                      */}
                      {!selectedAlbum?.trim() && g.album && (
                        <Badge tone="gray">{g.album}</Badge>
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

/**
 * アルバムのタブ 1 つ。
 *
 * ボタンではなくリンクにしているのは、
 * アルバムを開いた状態を URL で共有・ブックマークできるようにするため。
 */
function AlbumTab({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count?: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${
        active
          ? 'border-brand-500 bg-brand-500 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-700'
      }`}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span
          className={`tabular-nums text-xs ${active ? 'text-white/80' : 'text-slate-400'}`}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
