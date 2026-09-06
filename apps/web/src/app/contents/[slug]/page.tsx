import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@idol/db';
import { auth } from '@/auth';
import { accessLevelLabel, canAccess, formatJstDate, formatJstDateTime } from '@idol/shared';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody } from '@/components/ui/Card';
import { getSiteSectionVisibility } from '@/lib/app-setting';
import { GalleryGrid } from '@/components/gallery/GalleryGrid';
import { isContentPublished, isContentScheduled } from '@/lib/content-visibility';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const c = await prisma.content.findUnique({
    where: { slug },
    select: { title: true, excerpt: true },
  });
  return { title: c?.title ?? 'コンテンツ', description: c?.excerpt ?? undefined };
}

export default async function ContentDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { contentsVisible } = await getSiteSectionVisibility();
  if (!contentsVisible) notFound();

  const { slug } = await params;
  const session = await auth();

  const content = await prisma.content.findUnique({
    where: { slug },
    include: { images: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!content) notFound();

  /**
   * 公開予約を尊重する。
   *
   * 一覧 (publishedContentWhere) で除外していても、詳細を素通しにすると
   * slug を知っている人が予約時刻前に読めてしまう。
   *
   * ただし管理者は予約中でもプレビューできるようにする。
   * 予約した内容を公開前に確認できないと、誤字を直せないまま
   * 予約時刻を迎えることになる。
   */
  const isStaff = session?.user?.role === 'ADMIN' || session?.user?.role === 'SUPER_ADMIN';
  const published = isContentPublished(content);
  if (!published && !isStaff) notFound();

  const scheduled = isContentScheduled(content);

  const canView = canAccess(session?.user?.plan, content.accessLevel);
  const isGallery = content.type === 'GALLERY';

  /**
   * ギャラリー写真。
   *
   * ここが今回の修正の中心。`include: { images }` で取得はしていたのに
   * 一切描画していなかったため、ギャラリーを作っても写真が出なかった。
   */
  const photos = content.images.map((img) => ({
    url: img.url,
    caption: img.caption,
  }));

  return (
    <article
      className={`mx-auto px-4 py-6 sm:py-10 ${
        // ギャラリーは写真を大きく見せたいので本文より広い幅を使う。
        // ブログは «読み物» なので 1 行の文字数が増えすぎない max-w-3xl を維持する。
        isGallery ? 'max-w-5xl' : 'max-w-3xl'
      }`}
    >
      {/* 管理者が予約中の記事を開いたときの注意帯。
          これが無いと «もう公開されている» と誤解する。 */}
      {!published && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <span className="font-semibold">管理者プレビュー：</span>
          {scheduled && content.publishedAt
            ? `このコンテンツは ${formatJstDateTime(content.publishedAt)} に公開予約されています。会員にはまだ表示されません。`
            : 'このコンテンツは未公開です。会員にはまだ表示されません。'}
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone="gray">{content.type === 'BLOG' ? 'ブログ' : 'ギャラリー'}</Badge>
        {/* 生の enum 名 (PREMIUM/MEMBERS) をそのまま出していたため、
            公開範囲を増やしても新しい段階のバッジが出なかった。
            PUBLIC 以外は共通ラベルでバッジを出す。 */}
        {content.accessLevel !== 'PUBLIC' && (
          <Badge tone={content.accessLevel === 'PREMIUM' ? 'brand' : 'info'}>
            {accessLevelLabel(content.accessLevel)}
          </Badge>
        )}
      </div>
      <h1 className="text-2xl font-bold leading-snug text-slate-800 sm:text-3xl">{content.title}</h1>
      <p className="mt-2 text-xs text-slate-500 sm:text-sm">
        {content.publishedAt
          ? formatJstDate(content.publishedAt)
          : ''}
        {content.authorName ? ` ・ ${content.authorName}` : ''}
      </p>

      {content.coverImageUrl && (
        <div className="mt-6 aspect-video w-full overflow-hidden rounded-lg bg-slate-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={content.coverImageUrl} alt={content.title} className="h-full w-full object-cover" />
        </div>
      )}

      {!canView ? (
        <Card className="mt-8 border-brand-200 bg-brand-50">
          <CardBody className="text-center">
            <p className="mb-3 text-base font-semibold text-brand-700">
              このコンテンツは
              {content.accessLevel === 'PREMIUM' ? 'プレミアム' : 'スタンダード'}
              会員限定です
            </p>
            <p className="mb-4 text-sm text-slate-600">
              プランをアップグレードすると閲覧できます。
            </p>
            <Link
              href={session?.user ? '/me' : '/signin?callbackUrl=/me'}
              className="inline-block rounded-md bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              {session?.user ? 'プランを変更する' : 'ログイン / 登録'}
            </Link>
          </CardBody>
        </Card>
      ) : (
        <>
          {content.excerpt && (
            <p className="mt-6 rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {content.excerpt}
            </p>
          )}
          {/* 説明文。ギャラリーでは «いつ・どこの写真か» の説明にあたる。 */}
          {content.body?.trim() ? (
            <div
              className="prose prose-slate mt-8 max-w-none text-slate-800"
              // 管理API (POST/PATCH /api/admin/contents) の書き込み時に
              // sanitizeContentBody() でサニタイズ済みの HTML (RBAC + サニタイズの多層防御)
              dangerouslySetInnerHTML={{ __html: content.body }}
            />
          ) : null}

          {/*
            ギャラリー写真。
            ブログ記事にも content_images を紐づけることは技術的に可能だが、
            ブログの画像は本文 HTML の中に入るので、ここで二重に出さない。
          */}
          {isGallery && photos.length > 0 && (
            <GalleryGrid photos={photos} title={content.title} />
          )}

          {/* 写真が 0 枚のギャラリー。
              «壊れている» のか «まだ準備中» なのか読者に分からないので明示する。 */}
          {isGallery && photos.length === 0 && (
            <p className="mt-8 rounded-md bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              写真がまだ登録されていません。
            </p>
          )}
        </>
      )}
    </article>
  );
}
