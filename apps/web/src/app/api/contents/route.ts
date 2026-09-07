import { NextResponse } from 'next/server';
import { publishedContentWhere } from '@/lib/content-visibility';
import { prisma } from '@idol/db';
import { ListContentsQuerySchema, accessibleLevels, canAccess } from '@idol/shared';
import type { AccessLevelLiteral, PlanTypeLiteral } from '@idol/shared';
import { resolveApiSession } from '@/lib/api-auth';
import { errors, handle } from '@/lib/errors';
import { getSiteSectionVisibility } from '@/lib/app-setting';
import { albumFilterWhere, normalizeAlbumName } from '@/lib/gallery-album';
import { GALLERY_PREVIEW_COUNT, galleryPreviewImages, resolveGalleryCover } from '@/lib/gallery';

export const runtime = 'nodejs';

export const GET = handle(async (req: Request) => {
  const { contentsVisible } = await getSiteSectionVisibility();
  if (!contentsVisible) throw errors.notFound('コンテンツは現在非公開です');

  const url = new URL(req.url);
  const query = ListContentsQuerySchema.parse({
    type: url.searchParams.get('type') ?? undefined,
    tag: url.searchParams.get('tag') ?? undefined,
    album: url.searchParams.get('album') ?? undefined,
    page: url.searchParams.get('page') ?? 1,
    limit: url.searchParams.get('limit') ?? 12,
  });
  const session = await resolveApiSession(req);
  const plan = session?.user?.plan as PlanTypeLiteral | undefined;

  /**
   * ===== GALLERY: 鍵付き一覧 (Web版 /gallery ページと同じ挙動) =====
   *
   * ブログなど他の種別は「見られないものを一覧から除外する」が、
   * ギャラリーは Web 版 /gallery ページの方針 (見せて鍵をかける) に揃える。
   * 除外してしまうと「プレミアムにどんな写真があるか」が全く伝わらず、
   * プラン加入の判断材料が無くなるため。
   *
   * モバイルアプリ (Flutter) はこの REST API を経由するしかなく、
   * Web版のようにサーバーコンポーネントから直接 Prisma を呼べないため、
   * ここで Web版と同じ判定をして返す必要がある。
   */
  if (query.type === 'GALLERY') {
    const where = {
      ...publishedContentWhere(),
      type: 'GALLERY' as const,
      ...(query.tag ? { tags: { has: query.tag } } : {}),
      ...albumFilterWhere(query.album),
      // accessLevel による除外はしない。閲覧不可のものも
      // unlocked: false の鍵付きカードとして返す。
    };

    const [rows, total] = await Promise.all([
      prisma.content.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          type: true,
          slug: true,
          title: true,
          excerpt: true,
          coverImageUrl: true,
          accessLevel: true,
          album: true,
          publishedAt: true,
          authorName: true,
          tags: true,
          viewCount: true,
          // 一覧のタイル表示用に先頭数枚だけ取る (詳細は lib/gallery.ts)。
          // take を付けないと 48件 × 各60枚 = 最大2880行を一覧のためだけに
          // 読み込むことになるため、総数は別途 _count で数える。
          images: {
            orderBy: { sortOrder: 'asc' },
            take: GALLERY_PREVIEW_COUNT,
            select: { url: true, caption: true },
          },
          _count: { select: { images: true } },
        },
      }),
      prisma.content.count({ where }),
    ]);

    const items = rows.map((g) => {
      const accessLevel = g.accessLevel as AccessLevelLiteral;
      const unlocked = canAccess(plan, accessLevel);
      return {
        id: g.id,
        type: g.type,
        slug: g.slug,
        title: g.title,
        excerpt: g.excerpt,
        // 鍵付きの場合はサムネイルを一切返さない。
        // 返しても配信側 (/api/media/content-body-image/[id]) の
        // 権限チェックで 404 になり「壊れた画像」が並ぶだけになるため。
        coverImageUrl: unlocked ? resolveGalleryCover(g.coverImageUrl, g.images) : null,
        accessLevel: g.accessLevel,
        album: normalizeAlbumName(g.album),
        publishedAt: g.publishedAt,
        authorName: g.authorName,
        tags: g.tags,
        viewCount: g.viewCount,
        unlocked,
        previewImages: unlocked ? galleryPreviewImages(g.images) : [],
        /**
         * 枚数は鍵付きでもそのまま返す。
         *
         * Web版 /gallery は `const total = g._count.images` を
         * unlocked と無関係に算出し、ロック済みカードにも
         * 「写真 N 枚」バッジを出している (実機で確認済み:
         * 未ログインでも 2/3/4/4/4 と実数が表示される)。
         * ここで 0 にすると、アプリだけ「写真 0 枚」と表示され
         * Web と食い違う。
         *
         * 枚数を伏せない方が要件にも合う。伏せるべきなのは
         * 写真の URL (= 中身) であって、「何枚あるか」は
         * 「プレミアムに入ると何が見られるか」を伝える情報であり、
         * プラン加入の判断材料として出す価値がある
         * (鍵付きで見せる方針そのものと同じ理由)。
         * 中身は previewImages / coverImageUrl を null・空にすることで
         * 伏せてあり、配信側の権限チェックでも二重に守られている。
         */
        imageCount: g._count.images,
      };
    });

    return NextResponse.json({
      items,
      page: query.page,
      limit: query.limit,
      total,
      hasMore: query.page * query.limit < total,
    });
  }

  // ===== 既存挙動 (BLOG 等): 変更なし =====
  // 公開範囲の段階を追加したときにここの列挙を直し忘れると、
  // その段階のコンテンツが誰にも表示されなくなるので共通関数から導出する。
  const allowed = accessibleLevels(plan);

  const where = {
    // 公開予約を尊重する (詳細は lib/content-visibility.ts)。
    ...publishedContentWhere(),
    ...(query.type ? { type: query.type } : {}),
    ...(query.tag ? { tags: { has: query.tag } } : {}),
    accessLevel: { in: allowed },
  };

  const [items, total] = await Promise.all([
    prisma.content.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        type: true,
        slug: true,
        title: true,
        excerpt: true,
        coverImageUrl: true,
        accessLevel: true,
        publishedAt: true,
        authorName: true,
        tags: true,
        viewCount: true,
      },
    }),
    prisma.content.count({ where }),
  ]);

  return NextResponse.json({
    items,
    page: query.page,
    limit: query.limit,
    total,
    hasMore: query.page * query.limit < total,
  });
});
